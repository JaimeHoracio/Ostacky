import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import type { Manifest, ManifestItem } from "./github.js";
import { downloadFile } from "./github.js";
import { readLockfile, writeLockfile, removeFromLockfile, clearLockfile, type Lockfile } from "./lockfile.js";
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
 * Ensures agents/ and commands/ subdirs exist under an .opencode dir.
 */
export function ensureOpenCodePaths(opencodeDir: string): OpenCodePaths {
  const paths: OpenCodePaths = {
    root: opencodeDir,
    agents: join(opencodeDir, "agents"),
    commands: join(opencodeDir, "commands"),
  };
  for (const dir of [paths.root, paths.agents, paths.commands]) {
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

// ─── Lockfile helpers ─────────────────────────────────────────────────────────

function upsertLockfile(
  paths: OpenCodePaths,
  type: "agents" | "commands",
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
  };

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

export function isAgentInstalled(name: string, paths: OpenCodePaths): boolean {
  return existsSync(join(paths.agents, `${name}.md`));
}

export function isCommandInstalled(name: string, paths: OpenCodePaths): boolean {
  return existsSync(join(paths.commands, `${name}.md`));
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

export function uninstallAll(paths: OpenCodePaths): void {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) return;
  for (const name of Object.keys(lockfile.agents)) {
    uninstallAgent(name, paths);
  }
  for (const name of Object.keys(lockfile.commands)) {
    uninstallCommand(name, paths);
  }
  clearLockfile(paths.root);
}
