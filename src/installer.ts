import {
    existsSync,
    mkdirSync,
    writeFileSync,
    unlinkSync,
    readdirSync,
    statSync,
    copyFileSync,
    readFileSync,
    rmSync,
} from 'fs';
import { execFileSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import type { Manifest, ManifestItem } from './github.js';
import { downloadFile, getBundledSkillPath, getBundledMcpPath, PACKAGE_ROOT } from './github.js';
import {
    readLockfile,
    writeLockfile,
    getLockfilePath,
    removeFromLockfile,
    clearLockfile,
    type Lockfile,
} from './lockfile.js';
import { sha256 } from './security.js';
import type { OpenCodePaths } from './types.js';
import {
    copyDirRecursive,
    computeTreeHash,
    findExecutablePath,
    getCommandInvocation,
    isCommandAvailable,
    promoteStagedDirectory,
} from './fs.js';
import { readOpenCodeConfig, writeOpenCodeConfig, findOpenCodeConfig, setMcpEntryAtProjectRoot } from './config.js';

export type { OpenCodePaths };

/**
 * Builds the local MCP configuration entry from verified absolute paths.
 * Absolute paths avoid relying on OpenCode's launch directory or GUI PATH.
 */
export function createMcpConfigEntry(
    name: string,
    nodeExecutable: string,
    serverPath: string,
    statePath?: string
): Record<string, unknown> {
    const entry: Record<string, unknown> = {
        type: 'local',
        command: [nodeExecutable, serverPath],
        enabled: true,
    };
    if (name === 'ostacky-controller' && statePath) {
        entry.environment = { OSTACKY_STATE_PATH: statePath };
    }
    return entry;
}

function getVerifiedNodeExecutable(): string {
    const nodeExecutable = findExecutablePath('node');
    if (!nodeExecutable) {
        throw new Error('No se encontró Node.js en PATH; no se puede iniciar un MCP local.');
    }
    try {
        execFileSync(nodeExecutable, ['--version'], { stdio: 'pipe', timeout: 10_000 });
    } catch (error) {
        throw new Error(`Node.js no se puede ejecutar desde ${nodeExecutable}: ${(error as Error).message}`);
    }
    return nodeExecutable;
}

function validateMcpModule(nodeExecutable: string, serverPath: string, cwd: string): void {
    try {
        execFileSync(nodeExecutable, ['--input-type=module', '--eval', 'await import(process.env.OSTACKY_MCP_PROBE)'], {
            cwd,
            env: { ...process.env, OSTACKY_MCP_PROBE: pathToFileURL(serverPath).href },
            stdio: 'pipe',
            timeout: 15_000,
        });
    } catch (error) {
        throw new Error(`El MCP no pasó la validación de carga: ${(error as Error).message}`);
    }
}

/**
 * Per-MCP probe options.
 *
 * Different MCP servers expose different tool surfaces, so the probe must be
 * tailored per server. The default (`{ requiredTools: ['ping', 'start_request'], exerciseWrite: true }`)
 * matches the ostacky-controller contract. Other MCPs should pass narrower
 * requirements (e.g. `{ requiredTools: [], exerciseWrite: false }`) for
 * handshake-only validation — we verify that the MCP completes the JSON-RPC
 * handshake (initialize + notifications/initialized + tools/list without
 * errors) without hardcoding its tool names.
 */
export interface McpProbeOptions {
    /** Tool names that must be present in `tools/list`. Default: `['ping', 'start_request']`. */
    requiredTools?: string[];
    /**
     * If true, after `tools/list` succeeds the probe also calls `start_request`
     * to exercise a state-writing tool end-to-end. Only valid for MCPs that
     * accept such a call (currently only ostacky-controller). Default: derived
     * from `requiredTools` — true if it includes `'start_request'`.
     */
    exerciseWrite?: boolean;
}

const DEFAULT_PROBE_OPTIONS: Required<McpProbeOptions> = {
    requiredTools: ['ping', 'start_request'],
    exerciseWrite: true,
};

/** Starts an MCP server and verifies initialize, tools/list, and (optionally) a state-writing tool call. */
export async function probeMcpServer(
    nodeExecutable: string,
    serverPath: string,
    cwd: string,
    statePath?: string,
    options: McpProbeOptions = {}
): Promise<void> {
    const requiredTools = options.requiredTools ?? DEFAULT_PROBE_OPTIONS.requiredTools;
    const exerciseWrite = options.exerciseWrite ?? requiredTools.includes('start_request');
    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(nodeExecutable, [serverPath], {
                cwd,
                env: {
                    ...process.env,
                    ...(statePath ? { OSTACKY_STATE_PATH: statePath } : {}),
                },
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            let settled = false;
            let stderr = '';
            let stdoutBuffer = '';
            const requestTimeout = 10_000;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try {
                    child.stdin?.end();
                } catch {}
                if (child.exitCode === null) child.kill();
                error ? reject(error) : resolve();
            };
            const fail = (message: string) => finish(new Error(`${message}${stderr ? `: ${stderr.trim()}` : ''}`));
            const send = (message: Record<string, unknown>) => {
                try {
                    child.stdin?.write(JSON.stringify(message) + '\n');
                } catch (error) {
                    finish(error as Error);
                }
            };
            const timer = setTimeout(() => fail('El MCP no completó el health check a tiempo'), requestTimeout);
            child.once('error', (error) => finish(error));
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.once('exit', (code, signal) => {
                fail(`El MCP terminó durante el health check (código ${code ?? 'null'}, señal ${signal ?? 'ninguna'})`);
            });
            child.stdout?.on('data', (chunk) => {
                stdoutBuffer += chunk.toString();
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let message: { id?: number; result?: unknown; error?: { message?: string }; isError?: boolean };
                    try {
                        message = JSON.parse(line);
                    } catch {
                        continue;
                    }
                    if (message.error) {
                        fail(`El MCP respondió un error: ${message.error.message ?? 'desconocido'}`);
                        return;
                    }
                    if (message.id === 1) {
                        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
                        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
                        continue;
                    }
                    if (message.id === 2) {
                        const tools = (message.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
                        const missing = requiredTools.filter((name) => !tools.some((tool) => tool.name === name));
                        if (missing.length > 0) {
                            fail(`El MCP inició pero no expuso las tools requeridas: ${missing.join(', ')}`);
                            return;
                        }
                        if (exerciseWrite) {
                            send({
                                jsonrpc: '2.0',
                                id: 3,
                                method: 'tools/call',
                                params: { name: 'start_request', arguments: { requestId: 'installer-probe' } },
                            });
                            continue;
                        }
                        finish();
                        return;
                    }
                    if (message.id === 3) {
                        const result = message.result as { isError?: boolean } | undefined;
                        if (result?.isError) {
                            fail('La tool start_request falló durante el health check');
                            return;
                        }
                        finish();
                    }
                }
            });
            send({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'ostacky-installer', version: '0.7.1' },
                },
            });
        });
    } finally {
        if (statePath && existsSync(statePath)) rmSync(statePath, { force: true });
        if (statePath && existsSync(statePath + '.backup')) rmSync(statePath + '.backup', { force: true });
    }
}

interface FileSnapshot {
    path: string;
    content: string | null;
}

function takeFileSnapshot(path: string): FileSnapshot {
    return { path, content: existsSync(path) ? readFileSync(path, 'utf-8') : null };
}

function restoreFileSnapshot(snapshot: FileSnapshot): void {
    if (snapshot.content === null) {
        if (existsSync(snapshot.path)) rmSync(snapshot.path, { force: true });
        return;
    }
    writeFileSync(snapshot.path, snapshot.content, 'utf-8');
}

// ─── Lockfile helpers ─────────────────────────────────────────────────────────

function upsertLockfile(
    paths: OpenCodePaths,
    type: 'agents' | 'commands' | 'skills' | 'mcpServers',
    item: ManifestItem,
    manifest: Manifest,
    contentHash: string
): void {
    const existing: Lockfile = readLockfile(paths.root) ?? {
        version: manifest.version,
        lockedAt: new Date().toISOString(),
        repo: manifest.repo,
        tag: manifest.tag,
        agents: {},
        commands: {},
        skills: {},
    };

    // Lockfiles escritos antes de soportar skills no tendrán la clave.
    if (!existing.skills) existing.skills = {};
    if (!existing.mcpServers) existing.mcpServers = {};
    if (!existing[type]) existing[type] = {};

    existing[type]![item.name] = {
        version: item.version,
        installedAt: new Date().toISOString(),
        sha256: contentHash,
    };

    // Actualiza campos del manifest
    existing.tag = manifest.tag;
    existing.version = manifest.version;
    existing.lockedAt = new Date().toISOString();

    writeLockfile(paths.root, existing);
}

// ─── Install / uninstall ──────────────────────────────────────────────────────

/**
 * Reads a bundled asset file from the package (assets/ directory).
 * Returns null if the file doesn't exist in the bundle.
 */
function readBundledAsset(relativePath: string): string | null {
    const fullPath = join(PACKAGE_ROOT, relativePath);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, 'utf-8');
}

export async function installAgent(item: ManifestItem, manifest: Manifest, paths: OpenCodePaths): Promise<void> {
    let content: string;
    try {
        content = await downloadFile(manifest, item.file);
    } catch (downloadErr) {
        // Fallback: leer del bundle local si la descarga falla (ej: tag no publicado)
        const bundled = readBundledAsset(item.file);
        if (bundled === null) {
            throw new Error(
                `Descarga falló (${(downloadErr as Error).message}) y el asset no está bundleado en ${item.file}`
            );
        }
        content = bundled;
    }
    writeFileSync(join(paths.agents, `${item.name}.md`), content, 'utf-8');
    upsertLockfile(paths, 'agents', item, manifest, sha256(content));
}

export async function installCommand(item: ManifestItem, manifest: Manifest, paths: OpenCodePaths): Promise<void> {
    let content: string;
    try {
        content = await downloadFile(manifest, item.file);
    } catch (downloadErr) {
        const bundled = readBundledAsset(item.file);
        if (bundled === null) {
            throw new Error(
                `Descarga falló (${(downloadErr as Error).message}) y el asset no está bundleado en ${item.file}`
            );
        }
        content = bundled;
    }
    writeFileSync(join(paths.commands, `${item.name}.md`), content, 'utf-8');
    upsertLockfile(paths, 'commands', item, manifest, sha256(content));
}

/**
 * Copia la skill bundleada al directorio destino y registra el tree hash.
 * A diferencia de installAgent/installCommand, el origen NO se descarga
 * de GitHub: las skills viven dentro del paquete npm en `assets/skills/`.
 */
export async function installSkill(item: ManifestItem, manifest: Manifest, paths: OpenCodePaths): Promise<void> {
    const src = getBundledSkillPath(item.name);
    if (!existsSync(src)) {
        throw new Error(`Skill bundleada no encontrada: ${src}. ¿Falta el directorio assets/skills/${item.name}/?`);
    }

    const treeHash = computeTreeHash(src);

    if (item.sha256 && treeHash !== item.sha256) {
        throw new Error(
            `Tree hash inválido para skill "${item.name}"\n` +
                `  esperado: ${item.sha256}\n` +
                `  recibido: ${treeHash}`
        );
    }

    const dest = join(paths.skills, item.name);
    if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true });
    }
    copyDirRecursive(src, dest);

    upsertLockfile(paths, 'skills', item, manifest, treeHash);
}

/**
 * B3: Removes skill directories that are installed but no longer in the manifest.
 * Keeps lockfile consistent with filesystem. Returns list of pruned skill names.
 *
 * Use after upgrades to avoid orphaned skills from previous installations.
 */
export function pruneStaleSkills(paths: OpenCodePaths, manifest: Manifest): string[] {
    const expected = new Set<string>(manifest.skills.map((s) => s.name));
    const removed: string[] = [];
    if (!existsSync(paths.skills)) return removed;

    for (const entry of readdirSync(paths.skills)) {
        const dir = join(paths.skills, entry);
        try {
            if (!statSync(dir).isDirectory()) continue;
        } catch {
            continue;
        }
        if (!expected.has(entry)) {
            // Skill instalada que ya no está en el manifest → prune
            try {
                rmSync(dir, { recursive: true, force: true });
                removeFromLockfile(paths.root, 'skills', entry);
                removed.push(entry);
            } catch {
                /* best-effort */
            }
        }
    }
    return removed;
}

/**
 * Copia el MCP server al directorio destino, registra en opencode.jsonc y
 * actualiza el lockfile.
 *
 * En producción (paquete npm publicado): usa la versión bundleada en
 * `dist/mcp/<name>/index.js` — un único archivo autocontenido, sin
 * node_modules ni `npm install` necesario. Funciona en cualquier entorno
 * (bun, node, sin package manager).
 *
 * En desarrollo (running from source): copia el source desde `assets/mcp/`
 * (sin node_modules) y corre `bun install` o `npm install` para instalar
 * dependencias frescas.
 */
export async function installMcpServer(item: ManifestItem, manifest: Manifest, paths: OpenCodePaths): Promise<void> {
    const src = getBundledMcpPath(item.name);
    if (!existsSync(src)) {
        throw new Error(
            `MCP server bundleado no encontrado: ${src}. ` + `¿Falta el directorio assets/mcp/${item.name}/?`
        );
    }

    // Hash siempre se computa del source (assets/mcp/<name>/) para tracking
    const treeHash = computeTreeHash(src);

    if (item.sha256 && treeHash !== item.sha256) {
        throw new Error(
            `Tree hash inválido para MCP server "${item.name}"\n` +
                `  esperado: ${item.sha256}\n` +
                `  recibido: ${treeHash}`
        );
    }

    const nodeExecutable = getVerifiedNodeExecutable();
    const projectRoot = dirname(paths.root);
    const dest = join(paths.mcp, item.name);
    const staging = `${dest}.staging-${process.pid}-${Date.now()}`;
    const statePath = item.name === 'ostacky-controller' ? join(paths.root, 'ostacky-state.json') : undefined;

    try {
        mkdirSync(staging, { recursive: true });

        // Preferir versión bundleada (dist/mcp/) — self-contained, sin install.
        const bundledPath = join(PACKAGE_ROOT, 'dist', 'mcp', item.name, 'index.js');
        if (existsSync(bundledPath)) {
            copyFileSync(bundledPath, join(staging, 'index.js'));
            writeFileSync(join(staging, 'package.json'), JSON.stringify({ type: 'module' }) + '\n', 'utf-8');
        } else {
            // Dev fallback: copiar source sin node_modules e instalar dependencias antes de promoverlo.
            copyDirRecursive(src, staging, true);
            const useBun = isCommandAvailable('bun');
            const packageManager = useBun ? 'bun' : 'npm';
            if (!useBun && !isCommandAvailable('npm')) {
                throw new Error(`No se encontró Bun ni npm para instalar dependencias de ${item.name}.`);
            }
            const args = useBun ? ['install', '--no-save'] : ['install', '--no-audit', '--no-fund'];
            try {
                const invocation = getCommandInvocation(packageManager, args);
                execFileSync(invocation.command, invocation.args, {
                    cwd: staging,
                    stdio: 'pipe',
                    timeout: 60_000,
                });
            } catch (error) {
                throw new Error(
                    `No se pudieron instalar dependencias de ${item.name} con ${packageManager}: ${(error as Error).message}`
                );
            }
        }

        const stagedServerPath = join(staging, 'index.js');
        if (!existsSync(stagedServerPath)) {
            throw new Error(`El MCP ${item.name} no contiene index.js después de instalarse.`);
        }
        validateMcpModule(nodeExecutable, stagedServerPath, staging);
        // Per-MCP probe contract: only ostacky-controller owns `ping`+`start_request`
        // and can exercise a state-writing call. Other MCPs (e.g. openspec) have
        // their own tool surfaces we don't want to hardcode; we just verify the
        // handshake (initialize + notifications/initialized + tools/list without
        // errors). See McpProbeOptions for details.
        const isController = item.name === 'ostacky-controller';
        const probeOptions: McpProbeOptions = isController
            ? { requiredTools: ['ping', 'start_request'], exerciseWrite: true }
            : { requiredTools: [], exerciseWrite: false };
        await probeMcpServer(
            nodeExecutable,
            stagedServerPath,
            staging,
            isController ? join(staging, '.probe-state.json') : undefined,
            probeOptions
        );

        const configPath = findOpenCodeConfig(projectRoot) ?? join(projectRoot, 'opencode.json');
        const configSnapshot = takeFileSnapshot(configPath);
        const lockfileSnapshot = takeFileSnapshot(getLockfilePath(paths.root));
        const promotion = promoteStagedDirectory(staging, dest);
        try {
            setMcpEntryAtProjectRoot(
                projectRoot,
                item.name,
                createMcpConfigEntry(item.name, nodeExecutable, join(dest, 'index.js'), statePath)
            );
            upsertLockfile(paths, 'mcpServers', item, manifest, treeHash);
            promotion.commit();
        } catch (error) {
            try {
                restoreFileSnapshot(configSnapshot);
            } catch {}
            try {
                restoreFileSnapshot(lockfileSnapshot);
            } catch {}
            try {
                promotion.rollback();
            } catch {}
            throw error;
        }
    } finally {
        if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
}
export function isMcpServerInstalled(name: string, paths: OpenCodePaths): boolean {
    return existsSync(join(paths.mcp, name, 'index.js'));
}

export function isAgentInstalled(name: string, paths: OpenCodePaths): boolean {
    return existsSync(join(paths.agents, `${name}.md`));
}

export function isCommandInstalled(name: string, paths: OpenCodePaths): boolean {
    return existsSync(join(paths.commands, `${name}.md`));
}

export function isSkillInstalled(name: string, paths: OpenCodePaths): boolean {
    return existsSync(join(paths.skills, name, 'SKILL.md'));
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

export function uninstallAgent(name: string, paths: OpenCodePaths): boolean {
    const filePath = join(paths.agents, `${name}.md`);
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch {
        return false;
    }
    removeFromLockfile(paths.root, 'agents', name);
    return true;
}

export function uninstallCommand(name: string, paths: OpenCodePaths): boolean {
    const filePath = join(paths.commands, `${name}.md`);
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch {
        return false;
    }
    removeFromLockfile(paths.root, 'commands', name);
    return true;
}

export function uninstallSkill(name: string, paths: OpenCodePaths): boolean {
    const dirPath = join(paths.skills, name);
    try {
        if (existsSync(dirPath)) {
            rmSync(dirPath, { recursive: true, force: true });
        }
    } catch {
        return false;
    }
    removeFromLockfile(paths.root, 'skills', name);
    return true;
}

export function uninstallMcpServer(name: string, paths: OpenCodePaths): boolean {
    const dirPath = join(paths.mcp, name);
    try {
        if (existsSync(dirPath)) {
            rmSync(dirPath, { recursive: true, force: true });
        }
    } catch {
        return false;
    }

    // Remover de opencode.jsonc
    const projectRoot = dirname(paths.root);
    const configPath = findOpenCodeConfig(projectRoot);
    if (configPath) {
        const config = readOpenCodeConfig(configPath);
        if (config) {
            const mcp = config.mcp as Record<string, unknown> | undefined;
            if (mcp && mcp[name]) {
                delete mcp[name];
                if (Object.keys(mcp).length === 0) {
                    delete config.mcp;
                }
                writeOpenCodeConfig(configPath, config);
            }
        }
    }

    removeFromLockfile(paths.root, 'mcpServers', name);
    return true;
}

export function uninstallAll(paths: OpenCodePaths): void {
    const lockfile = readLockfile(paths.root);
    if (!lockfile) return;
    for (const name of Object.keys(lockfile.agents)) {
        uninstallAgent(name, paths);
    }
    for (const name of Object.keys(lockfile.commands)) {
        uninstallCommand(name, paths);
    }
    for (const name of Object.keys(lockfile.skills ?? {})) {
        uninstallSkill(name, paths);
    }
    for (const name of Object.keys(lockfile.mcpServers ?? {})) {
        uninstallMcpServer(name, paths);
    }

    // Also scan mcp/ directory for servers not in lockfile (legacy installs)
    if (existsSync(paths.mcp)) {
        for (const entry of readdirSync(paths.mcp)) {
            const dirPath = join(paths.mcp, entry);
            if (statSync(dirPath).isDirectory()) {
                uninstallMcpServer(entry, paths);
            }
        }
    }

    clearLockfile(paths.root);
}
