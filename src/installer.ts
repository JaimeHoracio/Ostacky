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
import { createHash } from "crypto";
import { join, resolve, dirname, relative } from "path";
import type { Manifest, ManifestItem } from "./github.js";
import { downloadFile, getBundledSkillPath, getBundledMcpPath } from "./github.js";
import {
  readLockfile,
  writeLockfile,
  removeFromLockfile,
  clearLockfile,
  type Lockfile,
} from "./lockfile.js";
import { sha256 } from "./security.js";
import type { OpenCodePaths } from "./types.js";

export type { OpenCodePaths };

/**
 * Walks up the directory tree looking for a .opencode directory.
 * Stops at a .git boundary to avoid escaping the project.
 */
export function findOpenCodeDir(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  while (true) {
    const opencodeDir = join(current, ".opencode");
    if (existsSync(opencodeDir)) return opencodeDir;

    if (existsSync(join(current, ".git"))) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Finds the project root by walking up and looking for .opencode or .git.
 * Falls back to cwd if neither is found.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, ".opencode")) ||
      existsSync(join(current, ".git"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

/**
 * Ensures agents/, commands/ and skills/ subdirs exist under an .opencode dir.
 */
export function ensureOpenCodePaths(opencodeDir: string): OpenCodePaths {
  const paths: OpenCodePaths = {
    root: opencodeDir,
    agents: join(opencodeDir, "agents"),
    commands: join(opencodeDir, "commands"),
    skills: join(opencodeDir, "skills"),
  };
  for (const dir of [paths.root, paths.agents, paths.commands, paths.skills]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/**
 * Creates a fresh .opencode structure under baseDir.
 */
export function createOpenCodeDir(baseDir: string): OpenCodePaths {
  return ensureOpenCodePaths(join(baseDir, ".opencode"));
}

// ─── File-system helpers ──────────────────────────────────────────────────────

/**
 * Copia un directorio recursivamente. Crea subdirectorios según necesite.
 * No preserva permisos, symlinks ni timestamps — solo contenido.
 */
export function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Calcula un hash determinístico de un directorio: lista archivos ordenados,
 * concatena sus paths relativos + sha256 de cada contenido, y devuelve el
 * sha256 hex del bloque combinado. Cambia si cambia cualquier archivo, su
 * contenido o su path.
 */
export function computeTreeHash(dir: string): string {
  const lines: string[] = [];
  walkForHash(dir, dir, lines);
  const combined = lines.sort().join("\n");
  return createHash("sha256").update(combined, "utf-8").digest("hex");
}

function walkForHash(root: string, current: string, lines: string[]): void {
  for (const entry of readdirSync(current)) {
    const full = join(current, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkForHash(root, full, lines);
    } else {
      const rel = relative(root, full);
      const content = readFileSync(full, "utf-8");
      lines.push(`${rel}:${sha256(content)}`);
    }
  }
}

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

  existing[type][item.name] = {
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

export async function installAgent(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
  const content = await downloadFile(manifest, item.file);
  writeFileSync(join(paths.agents, `${item.name}.md`), content, "utf-8");
  upsertLockfile(paths, "agents", item, manifest, sha256(content));
}

export async function installCommand(
  item: ManifestItem,
  manifest: Manifest,
  paths: OpenCodePaths
): Promise<void> {
  const content = await downloadFile(manifest, item.file);
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
 * Copia el MCP server bundleado al directorio destino, registra en
 * opencode.jsonc y actualiza el lockfile.
 * Sigue el mismo patrón que installSkill: origen local, tree hash.
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

  const treeHash = computeTreeHash(src);

  if (item.sha256 && treeHash !== item.sha256) {
    throw new Error(
      `Tree hash inválido para MCP server "${item.name}"\n` +
        `  esperado: ${item.sha256}\n` +
        `  recibido: ${treeHash}`
    );
  }

  const dest = join(paths.root, 'mcp', item.name);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  copyDirRecursive(src, dest);

  upsertLockfile(paths, "mcpServers", item, manifest, treeHash);

  // Registrar en opencode.jsonc
  const projectRoot = findProjectRoot();
  const configPath = findOpenCodeConfig(projectRoot);
  if (configPath) {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (!config.mcp) config.mcp = {};
    config.mcp[item.name] = {
      type: "local",
      command: ["node", `.opencode/mcp/${item.name}/index.js`],
      enabled: true,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
}

/**
 * Busca el archivo de configuración de OpenCode en el proyecto.
 */
export function findOpenCodeConfig(projectRoot: string): string | null {
  const candidates = ["opencode.json", "opencode.jsonc"];
  for (const name of candidates) {
    const full = join(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

export function isMcpServerInstalled(name: string, paths: OpenCodePaths): boolean {
  return existsSync(join(paths.root, 'mcp', name, 'index.js'));
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
  const dirPath = join(paths.root, 'mcp', name);
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
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (config.mcp && config.mcp[name]) {
        delete config.mcp[name];
        if (Object.keys(config.mcp).length === 0) {
          delete config.mcp;
        }
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      }
    } catch {
      // Si falla, solo continuamos
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
  clearLockfile(paths.root);
}

// ─── Stack installation (tools: CodeGraph, OpenSpec, Engram) ─────────────────

import { execSync } from "child_process";

export interface StackResult {
  codegraph: { success: boolean; message: string };
  openspec: { success: boolean; message: string };
  engram: { success: boolean; message: string };
  config: { success: boolean; message: string };
}

export function isCommandAvailable(cmd: string): boolean {
  try {
    if (process.platform === "win32") {
      execSync(`where ${cmd} >nul 2>&1`);
    } else {
      execSync(`which ${cmd} >/dev/null 2>&1`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Instala CodeGraph (binary) y lo configura para OpenCode.
 * Si ya está instalado, solo ejecuta la configuración.
 */
export function installCodeGraph(): { success: boolean; message: string } {
  if (!isCommandAvailable("codegraph")) {
    try {
      if (process.platform === "win32") {
        execSync(
          'powershell -c "irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex"',
          { stdio: "inherit", timeout: 120_000 }
        );
      } else {
        execSync(
          "curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh",
          { stdio: "inherit", timeout: 120_000 }
        );
      }
      if (!isCommandAvailable("codegraph")) {
        return {
          success: false,
          message:
            "CodeGraph instalado pero no está en PATH. ¿Necesitás reiniciar la terminal?",
        };
      }
    } catch (e) {
      return {
        success: false,
        message: `Error instalando CodeGraph: ${(e as Error).message}`,
      };
    }
  }

  // Configurar para OpenCode (corre siempre, incluso si ya estaba instalado)
  try {
    execSync("codegraph install --target=opencode --location=local --yes", {
      stdio: "pipe",
      timeout: 60_000,
    });
    execSync("codegraph init -i", { stdio: "pipe", timeout: 120_000 });
    return { success: true, message: "CodeGraph instalado y configurado para OpenCode" };
  } catch (e) {
    return {
      success: false,
      message: `Error configurando CodeGraph: ${(e as Error).message}`,
    };
  }
}

/**
 * Configura OpenSpec para el proyecto via npx (sin requerir instalación global).
 */
export function setupOpenSpec(): { success: boolean; message: string } {
  try {
    execSync("npx --yes openspec init --tools opencode --force", {
      stdio: "pipe",
      timeout: 120_000,
    });
    return { success: true, message: "OpenSpec configurado para OpenCode" };
  } catch (e) {
    return {
      success: false,
      message: `Error configurando OpenSpec: ${(e as Error).message}`,
    };
  }
}

/**
 * Instala Engram (binary) y lo configura para OpenCode.
 * Prueba go install primero (user-local), después Homebrew, después da una pista.
 */
export function installEngram(): { success: boolean; message: string } {
  if (isCommandAvailable("engram")) {
    // Ya instalado, solo configurar
    try {
      execSync("engram setup opencode", { stdio: "pipe", timeout: 30_000 });
      return { success: true, message: "Engram ya instalado y configurado para OpenCode" };
    } catch (e) {
      return {
        success: false,
        message: `Error configurando Engram: ${(e as Error).message}`,
      };
    }
  }

  // Intentar go install (user-local)
  if (isCommandAvailable("go")) {
    try {
      execSync(
        "go install github.com/Gentleman-Programming/engram/cmd/engram@latest",
        { stdio: "pipe", timeout: 120_000 }
      );
      if (isCommandAvailable("engram")) {
        execSync("engram setup opencode", { stdio: "pipe", timeout: 30_000 });
        return { success: true, message: "Engram instalado via go install y configurado" };
      }
    } catch {
      // fall through
    }
  }

  // Intentar Homebrew (macOS/Linux)
  if (
    isCommandAvailable("brew") &&
    (process.platform === "darwin" || process.platform === "linux")
  ) {
    try {
      execSync("brew install gentleman-programming/tap/engram", {
        stdio: "pipe",
        timeout: 120_000,
      });
      if (isCommandAvailable("engram")) {
        execSync("engram setup opencode", { stdio: "pipe", timeout: 30_000 });
        return { success: true, message: "Engram instalado via Homebrew y configurado" };
      }
    } catch {
      // fall through
    }
  }

  return {
    success: false,
    message:
      "No se pudo instalar Engram automáticamente.\n" +
      "  - Tenés Go? Ejecutá: go install github.com/Gentleman-Programming/engram/cmd/engram@latest\n" +
      "  - O descargá el binario: https://github.com/Gentleman-Programming/engram/releases\n" +
      "  - Después ejecutá: engram setup opencode",
  };
}

/**
 * Parchea opencode.json para eliminar el campo `plugin` (legacy de Superpowers).
 */
export function patchOpenCodeConfig(): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const candidates = ["opencode.json", "opencode.jsonc"];

  let configPath: string | null = null;
  for (const name of candidates) {
    const full = join(projectRoot, name);
    if (existsSync(full)) {
      configPath = full;
      break;
    }
  }

  if (!configPath) {
    return {
      success: false,
      message: "No se encontró opencode.json ni opencode.jsonc",
    };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    let changed = false;

    if ("plugin" in config) {
      delete config.plugin;
      changed = true;
    }

    if (changed) {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      return { success: true, message: "Config actualizada (plugin legacy eliminado)" };
    }

    return { success: true, message: "Config de OpenCode ya está limpia" };
  } catch (e) {
    return {
      success: false,
      message: `Error parcheando config: ${(e as Error).message}`,
    };
  }
}

/**
 * Orquestador: instala y configura todo el stack (CodeGraph + OpenSpec + Engram + Config).
 */
export function installStack(): StackResult {
  return {
    codegraph: installCodeGraph(),
    openspec: setupOpenSpec(),
    engram: installEngram(),
    config: patchOpenCodeConfig(),
  };
}

/**
 * Remueve la configuración de Engram del proyecto (entrada mcp.engram en opencode.json).
 * No desinstala el binario de Engram ni borra datos, solo limpia la config del proyecto.
 */
export function uninstallEngramConfig(): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const candidates = ["opencode.json", "opencode.jsonc"];

  let configPath: string | null = null;
  for (const name of candidates) {
    const full = join(projectRoot, name);
    if (existsSync(full)) {
      configPath = full;
      break;
    }
  }

  if (!configPath) {
    return { success: false, message: "No se encontró opencode.json ni opencode.jsonc" };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    let changed = false;

    if (config.mcp && "engram" in config.mcp) {
      delete config.mcp.engram;
      // Si mcp quedó vacío, eliminarlo también
      if (Object.keys(config.mcp).length === 0) {
        delete config.mcp;
      }
      changed = true;
    }

    if (!changed) {
      return { success: true, message: "Engram no estaba configurado en este proyecto" };
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { success: true, message: "Config de Engram eliminada de opencode.json" };
  } catch (e) {
    return {
      success: false,
      message: `Error limpiando config de Engram: ${(e as Error).message}`,
    };
  }
}
