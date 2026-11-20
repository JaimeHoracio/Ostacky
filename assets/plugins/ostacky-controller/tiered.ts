/**
 * tiered.ts — mirror de src/tiered.ts para plugin (self-contained)
 * Generado desde src/tiered.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Tiered helpers — single source of truth for trivial detection y niveles.
 *
 * Consumido por el plugin ostacky-controller/index.ts y engram.ts (mirror en package dir).
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

/**
 * Pregunta sobre hechos ya ejecutados en ESTA sesión (qué hicimos, qué cambió, qué falta).
 * Se responde desde el contexto + ostacky_get_state, sin codegraph ni mem_search.
 * Excluye pedidos de acción o propuesta: ante la duda gana "work" (costo completo, fail-safe).
 */
const SESSION_RECALL_RE =
  /\b(qu[eé]\s+(hicimos|hiciste|hizo|cambiamos|cambiaste|cambi[oó]|tocamos|tocaste|modificamos|modificaste|complet[oó]|completamos|falt[ao]n?|qued[oó]|quedaron|pendientes?)|(resum[ií]|resumen)\s+(de\s+)?(lo|la|esto|esta|el)\b|por\s+qu[eé]\s+(elegiste|decidiste|cambiaste|hiciste)|(cu[aá]l|cu[aá]les)\s+(fue|fueron|son|era|eran)\s+(los?|las?)?\s*(cambios?|archivos?|tasks?|pendientes?))\b/i;

const SESSION_ACTION_RE =
  /\b(propon\w*|sugier\w*|recomend\w*|arregl\w*|implement\w*|agreg\w*|cre(a|á)\w*|borr\w*|modific\w*|corr(e|é|ig\w*)|continu\w*|ejecut\w*|refactor\w*|fix\w*|hac(e|é)r?|cambi(a|á)\b|escrib\w*|quit\w*|actualiz\w*)/i;

export function isSessionQuestion(msg: string): boolean {
  if (!msg || msg.trim().length === 0) return false
  if (SESSION_ACTION_RE.test(msg)) return false
  return SESSION_RECALL_RE.test(msg)
}

export type Intent = "greeting" | "session_question" | "work"

/**
 * Clasificación única de intención del prompt. Orden: saludo > pregunta de sesión > trabajo.
 * `greeting` conserva la semántica histórica de isTrivial (solo estado DONE).
 */
export function classifyIntent(msg: string, state: string): Intent {
  if (isTrivial(msg, state)) return "greeting"
  if (isSessionQuestion(msg)) return "session_question"
  return "work"
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
