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
import { downloadFile, getBundledSkillPath } from "./github.js";
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
  type: "agents" | "commands" | "skills",
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
  clearLockfile(paths.root);
}
