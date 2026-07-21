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
  createWriteStream,
} from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname, relative } from "path";
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
 * Ensures agents/, commands/, skills/, mcp/ and tools/ subdirs exist under an .opencode dir.
 */
export function ensureOpenCodePaths(opencodeDir: string): OpenCodePaths {
  const paths: OpenCodePaths = {
    root: opencodeDir,
    agents: join(opencodeDir, "agents"),
    commands: join(opencodeDir, "commands"),
    skills: join(opencodeDir, "skills"),
    mcp: join(opencodeDir, "mcp"),
    tools: join(opencodeDir, "tools"),
  };
  for (const dir of [paths.root, paths.agents, paths.commands, paths.skills, paths.mcp, paths.tools]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/**
 * Crea subdirectorios de herramientas dentro de .opencode/tools/ para cada herramienta.
 */
export function ensureToolDirs(toolsDir: string, toolNames: string[]): void {
  for (const name of toolNames) {
    const dir = join(toolsDir, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
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
 * Si `skipGenerated` es true, omite node_modules/ y package-lock.json
 * (útil para copiar MCP servers source sin dependencias instaladas).
 */
export function copyDirRecursive(src: string, dest: string, skipGenerated: boolean = false): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skipGenerated && (entry === "node_modules" || entry === "package-lock.json")) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath, skipGenerated);
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
    // Skip node_modules and package-lock.json — they're generated, not source
    if (entry === "node_modules" || entry === "package-lock.json") continue;
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

// ─── JSONC config helpers ─────────────────────────────────────────────────────

/**
 * Strips // line comments and /* block comments from JSONC text.
 * Preserves strings — comments inside strings are not touched.
 * Also strips trailing commas that are valid in JSONC but not in JSON.
 */
function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      if (char === "\\") {
        result += char + (next ?? "");
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      result += char;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      i++;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    result += char;
    i++;
  }
  // Strip trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Reads an opencode config file (.json or .jsonc), stripping comments
 * so JSON.parse can handle it. Returns null if parsing fails.
 */
function readOpenCodeConfig(configPath: string): Record<string, unknown> | null {
  const raw = readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(stripJsoncComments(raw));
  } catch {
    return null;
  }
}

/**
 * Writes config as pretty-printed JSON with trailing newline.
 */
function writeOpenCodeConfig(configPath: string, config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Creates a minimal opencode.json (or .jsonc) at the project root if none exists.
 * Returns the path to the config file (existing or newly created).
 */
function ensureOpenCodeConfig(projectRoot: string): string {
  const existing = findOpenCodeConfig(projectRoot);
  if (existing) return existing;
  const configPath = join(projectRoot, "opencode.json");
  writeOpenCodeConfig(configPath, {
    $schema: "https://opencode.ai/config.json",
    mcp: {},
  });
  return configPath;
}

/**
 * Sets an MCP server entry in the opencode config, overwriting any existing entry.
 * Creates the config file if it doesn't exist. Use this for entries that must
 * point to a specific local binary (CodeGraph, Engram) — NOT for user-configured
 * entries that should be preserved.
 */
function setMcpEntry(name: string, entry: Record<string, unknown>): void {
  const projectRoot = findProjectRoot();
  const configPath = ensureOpenCodeConfig(projectRoot);
  const config = readOpenCodeConfig(configPath);
  if (!config) return;
  if (!config.mcp) config.mcp = {};
  (config.mcp as Record<string, unknown>)[name] = entry;
  writeOpenCodeConfig(configPath, config);
}

/**
 * Ensures an MCP server entry exists in the opencode config.
 * Creates the config file if it doesn't exist. Does NOT overwrite existing entries —
 * only adds the entry if it's missing. This is idempotent and preserves user config.
 */
function ensureMcpEntry(name: string, entry: Record<string, unknown>): void {
  const projectRoot = findProjectRoot();
  const configPath = ensureOpenCodeConfig(projectRoot);
  const config = readOpenCodeConfig(configPath);
  if (!config) return;
  if (!config.mcp) config.mcp = {};
  const mcp = config.mcp as Record<string, unknown>;
  if (!mcp[name]) {
    mcp[name] = entry;
    writeOpenCodeConfig(configPath, config);
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
      throw new Error(
        `MCP server "${item.name}" copiado pero ${installCmd} falló: ${(e as Error).message}.\n` +
          `Resolvé las dependencias manualmente:\n` +
          `  cd .opencode/mcp/${item.name} && bun install`
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
  clearLockfile(paths.root);
}

// ─── Stack installation (tools: CodeGraph, OpenSpec, Engram) ─────────────────

import { execSync } from "child_process";

export interface StackResult {
  codegraph: { success: boolean; message: string };
  openspec: { success: boolean; message: string };
  engram: { success: boolean; message: string };
  context7: { success: boolean; message: string };
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

// ─── Local binary download helpers ───────────────────────────────────────────

/**
 * Detecta el target triple (os-arch) para descargar el binario correcto.
 * Retorna null si la plataforma no está soportada.
 */
function detectPlatformTarget(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  let os: string;
  let cpu: string;
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "win32";
  else return null;
  if (arch === "arm64") cpu = "arm64";
  else if (arch === "x64") cpu = "x64";
  else return null;
  return `${os}-${cpu}`;
}

/**
 * Descarga un archivo desde una URL con un timeout.
 */
function downloadToFile(url: string, dest: string, timeoutMs: number = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal, headers: { "User-Agent": "ostacky-installer" } })
      .then((res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`HTTP ${res.status} ${res.statusText} descargando ${url}`));
          return;
        }
        const reader = res.body.getReader();
        const pump = ({ done, value }: { done: boolean; value?: Uint8Array }): Promise<void> => {
          if (done) {
            file.end();
            return Promise.resolve();
          }
          return new Promise((w) => file.write(Buffer.from(value!), () => w())).then(() =>
            reader.read().then(pump)
          );
        };
        return reader.read().then(pump);
      })
      .then(() => {
        clearTimeout(timer);
        file.on("finish", () => resolve());
      })
      .catch((err) => {
        clearTimeout(timer);
        file.destroy();
        try { unlinkSync(dest); } catch {}
        reject(err);
      });
  });
}

/**
 * Descarga y extrae un tar.gz/zip de GitHub Releases a un directorio destino.
 * Para tar.gz usa tar (POSIX) o powershell tar (Windows). Para zip en Windows usa Expand-Archive.
 */
async function downloadAndExtract(
  url: string,
  destDir: string,
  stripComponents: number = 1,
  timeoutMs: number = 180_000
): Promise<void> {
  const tmp = join(destDir, `.download-${Date.now()}`);
  if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, url.endsWith(".zip") ? "archive.zip" : "archive.tar.gz");
  try {
    await downloadToFile(url, archivePath, timeoutMs);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    if (process.platform === "win32" && url.endsWith(".zip")) {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: "pipe", timeout: 60_000 }
      );
    } else {
      const stripArg = stripComponents > 0 ? `--strip-components=${stripComponents}` : "";
      execSync(`tar -xzf "${archivePath}" -C "${destDir}" ${stripArg}`, {
        stdio: "pipe",
        timeout: 60_000,
      });
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Consulta la GitHub API (con fallback al redirect) para obtener el tag de la última release.
 */
async function fetchLatestReleaseTag(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "ostacky-installer" },
    });
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string };
      return data.tag_name ?? null;
    }
  } catch {}
  // Fallback: redirect de releases/latest → releases/tag/vX.Y.Z
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "ostacky-installer" },
    });
    const loc = res.headers.get("location") ?? "";
    const m = loc.match(/releases\/tag\/(v[^/]+)$/);
    if (m) return m[1];
  } catch {}
  return null;
}

/**
 * Instala CodeGraph (binary) descargándolo localmente a .opencode/tools/codegraph/.
 * No instala nada globalmente — todo es local al proyecto.
 * Crea .opencode/tools/codegraph/ y mueve AGENTS.md ahí si codegraph lo crea en la raíz.
 */
export async function installCodeGraph(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const projectRoot = findProjectRoot();
  const cgToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "codegraph");
  if (!existsSync(cgToolDir)) mkdirSync(cgToolDir, { recursive: true });

  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá CodeGraph manualmente.`,
    };
  }

  const localBin = join(cgToolDir, "bin", "codegraph");
  const localBinExe = localBin + (process.platform === "win32" ? ".exe" : "");

  // Si ya está descargado localmente, lo usamos
  if (existsSync(localBinExe)) {
    try {
      execSync(`"${localBinExe}" --version`, { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Binario corrupto — re-descargar
      try { rmSync(join(cgToolDir, "bin"), { recursive: true, force: true }); } catch {}
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!existsSync(localBinExe)) {
    const tag = await fetchLatestReleaseTag("colbymchenry/codegraph");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de CodeGraph desde GitHub.",
      };
    }
    const ext = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/codegraph-${target}.${ext}`;
    try {
      await downloadAndExtract(url, cgToolDir, 1, 180_000);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando CodeGraph ${tag}: ${(e as Error).message}`,
      };
    }
    if (!existsSync(localBinExe)) {
      return {
        success: false,
        message: `Descarga de CodeGraph ${tag} completada pero no se encontró el binario en ${localBinExe}.`,
      };
    }
    if (process.platform !== "win32") {
      try { execSync(`chmod +x "${localBinExe}"`, { stdio: "pipe" }); } catch {}
    }
  }

  // Inicializar el índice de CodeGraph en el proyecto
  try {
    execSync(`"${localBinExe}" init -i`, { stdio: "pipe", timeout: 120_000, cwd: projectRoot });
  } catch {
    // No fatal — el índice puede inicializarse después
  }

  // Ejecutar codegraph install --target opencode para configurar MCP y crear AGENTS.md
  // --target opencode asegura que SOLO toca opencode (no .claude/, .cursor/, etc.)
  // --location local usa el binario local (no global)
  try {
    execSync(`"${localBinExe}" install --target opencode --location local --yes`, {
      stdio: "pipe",
      timeout: 30_000,
      cwd: projectRoot,
    });
  } catch {
    // No fatal — la entrada MCP la seteamos nosotros abajo
  }

  // Mover AGENTS.md si codegraph lo creó en la raíz → .opencode/tools/codegraph/AGENTS.md
  const rootAgentsMd = join(projectRoot, "AGENTS.md");
  if (existsSync(rootAgentsMd)) {
    const dest = join(cgToolDir, "AGENTS.md");
    try {
      copyFileSync(rootAgentsMd, dest);
      unlinkSync(rootAgentsMd);
    } catch {
      // Si no se puede mover, lo dejamos — no es crítico
    }
  }

  // Re-assert nuestro MCP entry (en caso de que codegraph install lo haya cambiado)
  // Siempre apuntamos al binario local en .opencode/tools/codegraph/bin/codegraph
  setMcpEntry("codegraph", {
    type: "local",
    command: [`.opencode/tools/codegraph/bin/codegraph`, "serve", "--mcp"],
    enabled: true,
  });

  return { success: true, message: "CodeGraph instalado localmente en .opencode/tools/codegraph/ y configurado para OpenCode" };
}

/**
 * Configura OpenSpec para el proyecto via npx/bunx (sin requerir instalación global).
 * Usa bunx si bun está disponible, sino npx.
 */
export function setupOpenSpec(): { success: boolean; message: string } {
  const npxCmd = isCommandAvailable("bun") ? "bunx" : "npx --yes";
  try {
    execSync(`${npxCmd} openspec init --tools opencode --force`, {
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
 * Instala Engram (binary) descargándolo localmente a .opencode/tools/engram/bin/.
 * No instala nada globalmente — todo es local al proyecto.
 * Crea .opencode/tools/engram/bin/ y registra el MCP apuntando al binario local.
 * Los archivos extra (CHANGELOG, LICENSE, README) quedan en .opencode/tools/engram/.
 */
export async function installEngram(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const projectRoot = findProjectRoot();
  const engramToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "engram");
  const engramBinDir = join(engramToolDir, "bin");
  if (!existsSync(engramBinDir)) mkdirSync(engramBinDir, { recursive: true });

  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá Engram manualmente.`,
    };
  }

  const localBin = join(engramBinDir, "engram" + (process.platform === "win32" ? ".exe" : ""));

  // Si ya está descargado localmente, lo usamos
  if (existsSync(localBin)) {
    try {
      execSync(`"${localBin}" --version`, { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Binario corrupto — re-descargar
      try { unlinkSync(localBin); } catch {}
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!existsSync(localBin)) {
    const tag = await fetchLatestReleaseTag("Gentleman-Programming/engram");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de Engram desde GitHub.",
      };
    }
    // Engram usa versiones sin 'v' en el nombre del asset: engram_1.20.0_linux_amd64.tar.gz
    const versionNum = tag.replace(/^v/, "");
    const [os, cpu] = target.split("-");
    // Engram usa amd64 en vez de x64
    const engramCpu = cpu === "x64" ? "amd64" : cpu;
    const ext = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${versionNum}_${os}_${engramCpu}.${ext}`;
    try {
      // Extraer al directorio base (no bin/) — el tar.gz puede tener estructura plana
      await downloadAndExtract(url, engramToolDir, 0, 120_000);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando Engram ${tag}: ${(e as Error).message}`,
      };
    }
    // Buscar el binario extraído y moverlo a bin/
    const extractedBin = join(engramToolDir, "engram" + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(extractedBin) && extractedBin !== localBin) {
      try {
        copyFileSync(extractedBin, localBin);
        unlinkSync(extractedBin);
      } catch {}
    }
    if (!existsSync(localBin)) {
      // Puede estar en un subdirectorio — buscarlo
      const found = findBinaryInDir(engramToolDir, "engram");
      if (found && found !== localBin) {
        try {
          copyFileSync(found, localBin);
          if (process.platform !== "win32") execSync(`chmod +x "${localBin}"`, { stdio: "pipe" });
        } catch {}
      }
    }
    if (!existsSync(localBin)) {
      return {
        success: false,
        message: `Descarga de Engram ${tag} completada pero no se encontró el binario en ${localBin}.`,
      };
    }
    if (process.platform !== "win32") {
      try { execSync(`chmod +x "${localBin}"`, { stdio: "pipe" }); } catch {}
    }
  }

  // Registrar el MCP server apuntando al binario local en bin/
  setMcpEntry("engram", {
    type: "local",
    command: [`.opencode/tools/engram/bin/engram`, "mcp"],
    enabled: true,
  });

  // Instalar el plugin de OpenCode para Engram (no-fatal)
  // engram setup opencode instala el plugin global en ~/.config/opencode/plugins/
  // pero NO agrega la entrada MCP — eso ya lo hicimos arriba
  try {
    execSync(`"${localBin}" setup opencode`, { stdio: "pipe", timeout: 30_000 });
  } catch {
    // Plugin setup falló pero el binario y la entrada MCP ya están
  }

  return { success: true, message: "Engram instalado localmente en .opencode/tools/engram/bin/ y configurado para OpenCode (MCP + plugin)" };
}

/**
 * Busca un binario por nombre dentro de un directorio (recursivo).
 * Retorna la ruta absoluta o null si no lo encuentra.
 */
function findBinaryInDir(dir: string, name: string): string | null {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findBinaryInDir(full, name);
      if (found) return found;
    } else if (entry === name || entry === name + ".exe") {
      return full;
    }
  }
  return null;
}

/**
 * Configura Context7 para OpenCode.
 * Registra el MCP server remoto en opencode.jsonc y crea .opencode/tools/context7/.
 * Intenta además correr `npx ctx7 setup --opencode` para instalar el skill local.
 */
export function setupContext7(toolsDir?: string): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const ctx7ToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "context7");
  if (!existsSync(ctx7ToolDir)) mkdirSync(ctx7ToolDir, { recursive: true });

  // Registrar el MCP server remoto en opencode.jsonc
  ensureMcpEntry("context7", {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    enabled: true,
  });

  // Intentar instalar el skill via ctx7 setup --opencode (no-fatal)
  // Usar bunx si bun está disponible, sino npx
  const npxCmd = isCommandAvailable("bun") ? "bunx" : "npx --yes";
  try {
    execSync(`${npxCmd} ctx7 setup --opencode`, {
      stdio: "pipe",
      timeout: 60_000,
    });
    return { success: true, message: "Context7 configurado (MCP + skill instalado)" };
  } catch {
    // Si ctx7 setup falla, el MCP remoto ya está registrado — es suficiente
    return {
      success: true,
      message: "Context7 MCP registrado (skill opcional no instalada — corrí `npx ctx7 setup --opencode` manualmente si la querés)",
    };
  }
}

/**
 * Parchea opencode.json para eliminar el campo `plugin` (legacy de Superpowers).
 */
export function patchOpenCodeConfig(): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const configPath = findOpenCodeConfig(projectRoot);

  if (!configPath) {
    return {
      success: false,
      message: "No se encontró opencode.json ni opencode.jsonc",
    };
  }

  const config = readOpenCodeConfig(configPath);
  if (!config) {
    return {
      success: false,
      message: `Error parseando ${configPath}`,
    };
  }

  let changed = false;

  if ("plugin" in config) {
    delete config.plugin;
    changed = true;
  }

  if (changed) {
    writeOpenCodeConfig(configPath, config);
    return { success: true, message: "Config actualizada (plugin legacy eliminado)" };
  }

  return { success: true, message: "Config de OpenCode ya está limpia" };
}

/**
 * Orquestador: instala y configura todo el stack (CodeGraph + OpenSpec + Engram + Context7 + Config).
 * Si toolsDir se proporciona, cada herramienta crea su subdirectorio ahí.
 * Async porque CodeGraph y Engram descargan binarios localmente.
 */
export async function installStack(toolsDir?: string): Promise<StackResult> {
  return {
    codegraph: await installCodeGraph(toolsDir),
    openspec: setupOpenSpec(),
    engram: await installEngram(toolsDir),
    context7: setupContext7(toolsDir),
    config: patchOpenCodeConfig(),
  };
}

/**
 * Remueve la configuración de Engram del proyecto (entrada mcp.engram en opencode.json).
 * No desinstala el binario de Engram ni borra datos, solo limpia la config del proyecto.
 */
export function uninstallEngramConfig(): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const configPath = findOpenCodeConfig(projectRoot);

  if (!configPath) {
    return { success: false, message: "No se encontró opencode.json ni opencode.jsonc" };
  }

  const config = readOpenCodeConfig(configPath);
  if (!config) {
    return { success: false, message: `Error parseando ${configPath}` };
  }

  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (mcp && "engram" in mcp) {
    delete mcp.engram;
    if (Object.keys(mcp).length === 0) {
      delete config.mcp;
    }
    writeOpenCodeConfig(configPath, config);
    return { success: true, message: "Config de Engram eliminada de opencode.json" };
  }

  return { success: true, message: "Engram no estaba configurado en este proyecto" };
}

/**
 * Remueve toda la configuración del stack del proyecto:
 * - Entradas mcp.codegraph, mcp.context7, mcp.engram de opencode.json
 * - Directorio .codegraph/
 * - Directorio .opencode/tools/
 * No toca los binarios globales (codegraph, engram) ni los datos de Engram (~/.engram/).
 */
export function uninstallStackConfig(paths: OpenCodePaths): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const removed: string[] = [];

  // 1. Remover entradas MCP del stack de opencode.json
  const configPath = findOpenCodeConfig(projectRoot);
  if (configPath) {
    const config = readOpenCodeConfig(configPath);
    if (config) {
      const mcp = config.mcp as Record<string, unknown> | undefined;
      let changed = false;
      if (mcp) {
        for (const name of ["codegraph", "context7", "engram"]) {
          if (name in mcp) {
            delete mcp[name];
            removed.push(`mcp.${name}`);
            changed = true;
          }
        }
        if (Object.keys(mcp).length === 0) {
          delete config.mcp;
          changed = true;
        }
      }
      if (changed) {
        writeOpenCodeConfig(configPath, config);
      }
    }
  }

  // 2. Remover .codegraph/
  const codegraphDir = join(projectRoot, ".codegraph");
  if (existsSync(codegraphDir)) {
    try {
      rmSync(codegraphDir, { recursive: true, force: true });
      removed.push(".codegraph/");
    } catch {
      // no fatal
    }
  }

  // 3. Remover .opencode/tools/
  if (existsSync(paths.tools)) {
    try {
      rmSync(paths.tools, { recursive: true, force: true });
      removed.push(".opencode/tools/");
    } catch {
      // no fatal
    }
  }

  if (removed.length === 0) {
    return { success: true, message: "No había configuración del stack para remover" };
  }

  return {
    success: true,
    message: `Removido: ${removed.join(", ")}. Los binarios globales (codegraph, engram) no se tocaron.`,
  };
}
