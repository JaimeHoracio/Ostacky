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
} from "fs";
import { execSync } from "child_process";
import { join } from "path";
import type { Manifest, ManifestItem } from "./github.js";
import { downloadFile, getBundledSkillPath, getBundledMcpPath, PACKAGE_ROOT } from "./github.js";
import {
  readLockfile,
  writeLockfile,
  removeFromLockfile,
  clearLockfile,
  type Lockfile,
} from "./lockfile.js";
import { sha256 } from "./security.js";
import type { OpenCodePaths } from "./types.js";
import {
  findProjectRoot,
  copyDirRecursive,
  computeTreeHash,
  isCommandAvailable,
} from "./fs.js";
import {
  readOpenCodeConfig,
  writeOpenCodeConfig,
  findOpenCodeConfig,
  ensureMcpEntry,
} from "./config.js";
import { installStack, uninstallStackConfig, type StackResult } from "./stack.js";

export type { OpenCodePaths };


// ─── Lockfile helpers ─────────────────────────────────────────────────────────

function upsertLockfile(
  paths: OpenCodePaths,
  type: "agents" | "commands" | "skills" | "mcpServers",
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
  return readFileSync(fullPath, "utf-8");
}

export async function installAgent(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
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
  writeFileSync(join(paths.agents, `${item.name}.md`), content, "utf-8");
  upsertLockfile(paths, "agents", item, manifest, sha256(content));
}

export async function installCommand(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
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
  writeFileSync(join(paths.commands, `${item.name}.md`), content, "utf-8");
  upsertLockfile(paths, "commands", item, manifest, sha256(content));
}

/**
 * Copia la skill bundleada al directorio destino y registra el tree hash.
 * A diferencia de installAgent/installCommand, el origen NO se descarga
 * de GitHub: las skills viven dentro del paquete npm en `assets/skills/`.
 */
export async function installSkill(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
  const src = getBundledSkillPath(item.name);
  if (!existsSync(src)) {
    throw new Error(
      `Skill bundleada no encontrada: ${src}. ¿Falta el directorio assets/skills/${item.name}/?`
    );
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

  upsertLockfile(paths, "skills", item, manifest, treeHash);
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
export async function installMcpServer(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
  const src = getBundledMcpPath(item.name);
  if (!existsSync(src)) {
    throw new Error(
      `MCP server bundleado no encontrado: ${src}. ` +
      `¿Falta el directorio assets/mcp/${item.name}/?`
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

  const dest = join(paths.mcp, item.name);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });

  // Preferir versión bundleada (dist/mcp/) — self-contained, sin install
  const bundledPath = join(PACKAGE_ROOT, "dist", "mcp", item.name, "index.js");
  if (existsSync(bundledPath)) {
    copyFileSync(bundledPath, join(dest, "index.js"));
  } else {
    // Dev fallback: copiar source sin node_modules y instalar dependencias
    copyDirRecursive(src, dest, true);
    const installCmd = isCommandAvailable("bun")
      ? "bun install --no-save"
      : "npm install --no-audit --no-fund";
    try {
      const output = execSync(installCmd, {
        cwd: dest,
        encoding: "utf-8",
        timeout: 60_000,
      });
      if (output) console.error(output);
    } catch (e) {
      console.error(
        `[WARN] MCP server "${item.name}" copiado pero ${installCmd} falló: ${(e as Error).message}.\n` +
          `  Resolvé las dependencias manualmente: cd .opencode/mcp/${item.name} && bun install`
      );
    }
  }

  upsertLockfile(paths, "mcpServers", item, manifest, treeHash);

  // Registrar en opencode.json (o opencode.jsonc) — crea el config si no existe
  ensureMcpEntry(item.name, {
    type: "local",
    command: ["node", `.opencode/mcp/${item.name}/index.js`],
    enabled: true,
  });
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
  return existsSync(join(paths.skills, name, "SKILL.md"));
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
  removeFromLockfile(paths.root, "agents", name);
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
  removeFromLockfile(paths.root, "commands", name);
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
  removeFromLockfile(paths.root, "skills", name);
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
  const projectRoot = findProjectRoot();
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

  removeFromLockfile(paths.root, "mcpServers", name);
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

