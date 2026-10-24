import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExecutablePath, computeTreeHash } from '../src/fs.js';
import { sha256 } from '../src/security.js';
import { assertBundledTreeHash, installMcpServer } from '../src/installer.js';
import type { OpenCodePaths } from '../src/types.js';
import { getBundledExpectedHash } from '../src/github.js';
import { buildMcpBundles } from '../scripts/build-mcp-bundles.ts';

/**
 * mcp-bundle-integrity: el installer prefiere `dist/mcp/<name>/index.js`
 * (self-contained) y cae al fallback dev (copiar assets + instalar deps) cuando
 * no existe. Estos tests fijan que el artefacto sea realmente autocontenido y
 * que el hash validado sea el del artefacto, no el del árbol de assets.
 */

const projectRoot = join(import.meta.dir, '..');
const nodeBin = findExecutablePath('node');

const bases: string[] = [];

function newDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    bases.push(dir);
    return dir;
}

afterEach(() => {
    while (bases.length) rmSync(bases.pop()!, { recursive: true, force: true });
});

/** Cliente JSON-RPC mínimo para hablarle al bundle por stdio. */
class McpClient {
    private child: ChildProcessWithoutNullStreams;
    private buf = '';
    private nextId = 1;
    private pending = new Map<number, (msg: any) => void>();

    constructor(serverPath: string, cwd: string) {
        this.child = spawn(nodeBin!, [serverPath], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
        this.child.stdout.on('data', (chunk) => {
            this.buf += chunk.toString();
            const lines = this.buf.split(/\r?\n/);
            this.buf = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let msg: any;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                const resolve = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
                if (resolve) {
                    this.pending.delete(msg.id);
                    resolve(msg);
                }
            }
        });
        this.child.stderr.on('data', () => {});
    }

    private request(method: string, params: unknown): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout esperando ${method}`));
            }, 15_000);
            this.pending.set(id, (msg) => {
                clearTimeout(timer);
                resolve(msg);
            });
            this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    async init(): Promise<void> {
        await this.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'ostacky-bundle-test', version: '0' },
        });
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    }

    async call(name: string, args: Record<string, unknown>): Promise<any> {
        const msg = await this.request('tools/call', {
            name,
            arguments: args,
            _meta: { 'ai.opencode/sessionID': 'sess-bundle' },
        });
        const text = msg?.result?.content?.[0]?.text;
        return typeof text === 'string' ? JSON.parse(text) : msg?.result;
    }

    stop(): void {
        try {
            this.child.stdin.end();
        } catch {}
        this.child.kill();
    }
}

describe('build:mcp — bundles autocontenidos', () => {
    it('genera dist/mcp/<name>/index.js para cada mcpServers[] del manifest', async () => {
        const outDir = join(newDir('ostacky-bundles-'), 'mcp');
        const built = await buildMcpBundles(projectRoot, outDir);

        const names = built.map((b) => b.name).sort();
        expect(names).toEqual(['openspec', 'ostacky-controller']);
        for (const bundle of built) {
            expect(existsSync(bundle.outfile)).toBe(true);
            // Un bundle vacío (sin deps) no sería autocontenido.
            expect(bundle.bytes).toBeGreaterThan(100_000);
            // Sin package.json con type:module, node puede tratar el .js como CJS.
            const pkg = JSON.parse(readFileSync(join(outDir, bundle.name, 'package.json'), 'utf-8'));
            expect(pkg.type).toBe('module');
        }
    }, 60_000);

    it('el bundle del controller corre sin node_modules y responde ping + start_request', async () => {
        if (!nodeBin) {
            // Sin node no hay producto: el installer tampoco podría correr el MCP.
            return;
        }
        const outDir = join(newDir('ostacky-bundles-run-'), 'mcp');
        await buildMcpBundles(projectRoot, outDir);

        const bundleDir = join(outDir, 'ostacky-controller');
        // El bundle vive en un dir SIN node_modules: si depende de deps externas, explota acá.
        expect(existsSync(join(bundleDir, 'node_modules'))).toBe(false);

        const runDir = newDir('ostacky-bundle-run-');
        const client = new McpClient(join(bundleDir, 'index.js'), runDir);
        try {
            await client.init();
            const ping = await client.call('ping', {});
            expect(ping.pong).toBe(true);
            const started = await client.call('start_request', { requestId: 'bundle-test', force: true });
            expect(started.requestId).toBe('bundle-test');
        } finally {
            client.stop();
        }
    }, 60_000);
    it('aborta antes de copiar cuando el hash del bundle no coincide', async () => {
        const bundlePath = join(projectRoot, 'dist', 'mcp', 'ostacky-controller', 'index.js');
        if (!existsSync(bundlePath)) return; // dev sin build: sin artefacto no hay qué validar
        const original = readFileSync(bundlePath);
        const manifest = JSON.parse(readFileSync(join(projectRoot, 'manifest.json'), 'utf-8')) as {
            mcpServers: Array<{ name: string; sha256: string; sourceSha256?: string }>;
        };
        const item = manifest.mcpServers.find((s) => s.name === 'ostacky-controller')!;

        const sandbox = newDir('ostacky-bundle-tamper-');
        const root = join(sandbox, '.opencode');
        const paths: OpenCodePaths = {
            root,
            agents: join(root, 'agents'),
            commands: join(root, 'commands'),
            plugins: join(root, 'plugins'),
            skills: join(root, 'skills'),
            mcp: join(root, 'mcp'),
            tools: join(root, 'tools'),
        };

        try {
            writeFileSync(bundlePath, Buffer.concat([original, Buffer.from('\n// tampered\n')]));
            await expect(
                installMcpServer(item as never, manifest as never, paths)
            ).rejects.toThrow(/sha256/);
            expect(existsSync(join(paths.mcp, 'ostacky-controller'))).toBe(false);
            const leftovers = existsSync(paths.mcp)
                ? readdirSync(paths.mcp).filter((entry) => entry.includes('.staging-'))
                : [];
            expect(leftovers).toEqual([]);
        } finally {
            writeFileSync(bundlePath, original);
        }
        // El bundle quedó restaurado: el manifest sigue siendo válido.
        expect(sha256(readFileSync(bundlePath, 'utf-8'))).toBe(item.sha256);
    }, 30_000);
});

describe('hash del artefacto, no del árbol', () => {
    it('sourceSha256 es el tree hash del source bundleado', () => {
        expect(getBundledExpectedHash('mcpServers', 'ostacky-controller', 'sourceSha256')).toBe(
            computeTreeHash(join(projectRoot, 'assets', 'mcp', 'ostacky-controller'))
        );
    });

    it('sha256 (artefacto) coincide con el bundle cuando dist/mcp existe', () => {
        const bundlePath = join(projectRoot, 'dist', 'mcp', 'ostacky-controller', 'index.js');
        if (!existsSync(bundlePath)) return; // dev sin build: lo cubre el fallback
        expect(getBundledExpectedHash('mcpServers', 'ostacky-controller', 'sha256')).toBe(
            sha256(readFileSync(bundlePath, 'utf-8'))
        );
    });

    it('aborta nombrando el campo cuando el hash del artefacto no coincide', () => {
        expect(() => assertBundledTreeHash('mcpServers', 'ostacky-controller', 'f'.repeat(64), 'sha256')).toThrow(
            /sha256/
        );
        expect(() => assertBundledTreeHash('mcpServers', 'ostacky-controller', 'f'.repeat(64), 'sourceSha256')).toThrow(
            /sourceSha256/
        );
    });
});
