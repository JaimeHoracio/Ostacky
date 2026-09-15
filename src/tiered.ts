/**
 * Tiered helpers — single source of truth for trivial detection y niveles.
 *
 * Ambos plugins (ostacky-plugin.ts y engram.ts) importan de acá.
 * No duplicar regex. Cache-friendly: isTrivial no muta system[0], solo decide hint.
 * LEVEL_THRESHOLDS es la única definición de niveles (D6).
 */

export const LEVEL_THRESHOLDS = {
  "0": { maxFiles: 1, maxLines: 15, hasAPI: false, desc: "1 archivo, sin API, <15 líneas" },
  "0+1": { maxFiles: 2, maxLines: 30, hasAPI: false, desc: "1-2 archivos, sin API, <30 líneas" },
  "1+": { maxFiles: Infinity, maxLines: Infinity, hasAPI: true, desc: "API, deps, >30 líneas, cross-module" },
} as const;

export function classifyLevel({ fileCount, estLines, hasAPI }: { fileCount: number; estLines: number; hasAPI: boolean }): "0" | "0+1" | "1+" {
  if (hasAPI || estLines > 30 || fileCount > 2) return "1+";
  if (estLines > 15 || fileCount > 1) return "0+1";
  return "0";
}

export function isTrivial(msg: string, state: string): boolean {
  if (!msg || state !== "DONE") return false
  if (msg.trim().length >= 30) return false
  if (!/^(hola|hey|gracias|buenas|hi|hello)\b/i.test(msg.trim())) return false
  if (/(necesito|quiero|agregá|fix|bug|feature|auth|spec|implementar)/i.test(msg)) return false
  return true
}

export function getControllerState(directory: string): string {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const { join } = require("node:path") as typeof import("node:path")
    const statePath =
      process.env.OSTACKY_STATE_PATH || join(directory, ".opencode", "ostacky-state.json")
    const raw = readFileSync(statePath, "utf-8")
    const j = JSON.parse(raw)
    return j.state ?? "DONE"
  } catch {
    return "DONE"
  }
}
