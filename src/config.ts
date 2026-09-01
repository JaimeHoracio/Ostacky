import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { findProjectRoot } from "./fs.js";

// ─── JSONC config helpers ─────────────────────────────────────────────────────

/**
 * Strips // line comments and /* block comments from JSONC text.
 * Preserves strings — comments inside strings are not touched.
 * Also strips trailing commas that are valid in JSONC but not in JSON.
 */
export function stripJsoncComments(text: string): string {
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
 * so JSON.parse can handle it. Returns null if the file cannot be read
 * or parsed.
 */
export function readOpenCodeConfig(configPath: string): Record<string, unknown> | null {
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
export function writeOpenCodeConfig(configPath: string, config: Record<string, unknown>): void {
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, configPath);
  } finally {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
  }
}

/**
 * Creates a minimal opencode.json (or .jsonc) at the project root if none exists.
 * Returns the path to the config file (existing or newly created).
 */
export function ensureOpenCodeConfig(projectRoot: string): string {
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
 * Finds the opencode.json or opencode.jsonc config file in the project root.
 * Returns the full path to the first match, or null if neither exists.
 */
export function findOpenCodeConfig(projectRoot: string): string | null {
  const candidates = ["opencode.json", "opencode.jsonc"];
  for (const name of candidates) {
    const full = join(projectRoot, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Sets an MCP server entry in the opencode config, overwriting any existing entry
 * with the same name.
 * Creates the config file if it doesn't exist. Use this for entries that must
 * point to a specific local binary (CodeGraph, Engram) — NOT for user-configured
 * entries that should be preserved.
 */
export function setMcpEntry(name: string, entry: Record<string, unknown>): void {
  setMcpEntryAtProjectRoot(findProjectRoot(), name, entry);
}

/**
 * Sets an MCP entry at an explicit project root. Keeping the root explicit
 * prevents installers that already resolved a target directory from silently
 * writing configuration for a different process working directory.
 */
export function setMcpEntryAtProjectRoot(
  projectRoot: string,
  name: string,
  entry: Record<string, unknown>
): void {
  const configPath = ensureOpenCodeConfig(projectRoot);
  const config = readOpenCodeConfig(configPath);
  if (!config) throw new Error(`Error parseando ${configPath}`);
  if (!config.mcp) config.mcp = {};
  (config.mcp as Record<string, unknown>)[name] = entry;
  writeOpenCodeConfig(configPath, config);
}

/**
 * Ensures an MCP server entry exists in the opencode config.
 * Creates the config file if it doesn't exist. Does NOT overwrite existing entries —
 * only adds the entry if it's missing. This is idempotent and preserves user config.
 */
export function ensureMcpEntry(name: string, entry: Record<string, unknown>): void {
  ensureMcpEntryAtProjectRoot(findProjectRoot(), name, entry);
}

/** Adds an MCP entry only when it is absent at the supplied project root. */
export function ensureMcpEntryAtProjectRoot(
  projectRoot: string,
  name: string,
  entry: Record<string, unknown>
): void {
  const configPath = ensureOpenCodeConfig(projectRoot);
  const config = readOpenCodeConfig(configPath);
  if (!config) throw new Error(`Error parseando ${configPath}`);
  if (!config.mcp) config.mcp = {};
  const mcp = config.mcp as Record<string, unknown>;
  if (!mcp[name]) {
    mcp[name] = entry;
    writeOpenCodeConfig(configPath, config);
  }
}

/**
 * Patches opencode.json to remove the legacy `plugin` field
 * (from the deprecated Superpowers era).
 */
export function patchOpenCodeConfig(projectRoot: string = findProjectRoot()): { success: boolean; message: string } {
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

  // Context7 removido del stack — limpiar si quedó de instalaciones previas
  if (config.mcp && typeof config.mcp === "object" && "context7" in (config.mcp as Record<string, unknown>)) {
    delete (config.mcp as Record<string, unknown>).context7;
    if (Object.keys(config.mcp as Record<string, unknown>).length === 0) delete config.mcp;
    changed = true;
  }

  if (changed) {
    writeOpenCodeConfig(configPath, config);
    return { success: true, message: "Config actualizada (plugin legacy eliminado)" };
  }

  return { success: true, message: "Config de OpenCode ya está limpia" };
}
