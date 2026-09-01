/**
 * Tiered helpers — single source of truth for trivial detection.
 *
 * Ambos plugins (ostacky-plugin.ts y engram.ts) importan de acá.
 * No duplicar regex. Cache-friendly: isTrivial no muta system[0], solo decide hint.
 */

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
