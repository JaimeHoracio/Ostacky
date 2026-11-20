/**
 * session-slots — mirror de src/session-slots.ts
 * Generado desde src/session-slots.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Política pura de asignación de slots de estado por sesión (session-state-files).
 *
 * No hace I/O: recibe el índice (metadatos de cada slot) y decide. El controller es quien
 * persiste la decisión bajo lock + revision. Ver openspec/changes/session-state-files.
 */

export const TERMINAL_REQUEST_STATES = ["DONE", "ABANDONED"] as const;

export interface SlotInfo {
  slot: string;
  overflow: boolean;
  quarantined: boolean;
  sessionId: string | null;
  requestId: string | null;
  state: string | null;
  /** epoch ms del último heartbeat de la sesión dueña (0 si no hay). */
  ownerHeartbeat: number;
  /** epoch ms del último uso del slot. */
  lastUsedAt: number;
}

export interface PoolConfig {
  poolMax: number;
  overflowMax: number;
  activeMs: number;
  recycleMs: number;
}

export const POOL_DEFAULTS = {
  poolMax: 10,
  overflowMax: 5,
  activeMinutes: 15,
  recycleDays: 7,
} as const;

/** Lee la configuración de variables de entorno; valores inválidos o no positivos → default. */
export function parsePoolConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    poolMax: Math.floor(num(env.OSTACKY_SESSION_POOL_MAX, POOL_DEFAULTS.poolMax)),
    overflowMax: Math.floor(num(env.OSTACKY_SESSION_OVERFLOW_MAX, POOL_DEFAULTS.overflowMax)),
    activeMs: num(env.OSTACKY_SESSION_ACTIVE_MIN, POOL_DEFAULTS.activeMinutes) * 60_000,
    recycleMs: num(env.OSTACKY_SESSION_RECYCLE_DAYS, POOL_DEFAULTS.recycleDays) * 86_400_000,
  };
}

/** Sesión activa: request no terminal con heartbeat dentro de la ventana. */
export function isActiveSlot(s: SlotInfo, now: number, cfg: PoolConfig): boolean {
  if (!s.sessionId || !s.requestId || s.quarantined) return false;
  if (s.state && (TERMINAL_REQUEST_STATES as readonly string[]).includes(s.state)) return false;
  return s.ownerHeartbeat > 0 && now - s.ownerHeartbeat <= cfg.activeMs;
}

/** Elegible para reemplazo automático: sin request o terminal, no activa, y sin uso hace más de N días. */
export function isRecycleEligible(s: SlotInfo, now: number, cfg: PoolConfig): boolean {
  if (s.quarantined) return false;
  const terminal = !s.requestId || (!!s.state && (TERMINAL_REQUEST_STATES as readonly string[]).includes(s.state));
  if (!terminal) return false;
  return now - s.lastUsedAt > cfg.recycleMs;
}

export type SlotDecision =
  | { kind: "reuse"; slot: string }
  | { kind: "free"; slot: string }
  | { kind: "create"; slot: string; overflow: boolean; notify: string[] }
  | { kind: "recycle"; slot: string; previousSessionId: string | null; notify: string[] }
  | { kind: "ask"; candidates: SlotInfo[]; notify: string[] };

const byOldestFirst = (a: SlotInfo, b: SlotInfo) => a.lastUsedAt - b.lastUsedAt || a.slot.localeCompare(b.slot);

/**
 * Decide qué slot usa `sessionId`. Orden:
 * 1) slot propio; 2) libre (base antes que extensión); 3) crear base si hay tope disponible;
 * 4) reciclar elegible (base antes que extensión, más antiguo primero);
 * 5) con `poolMax` o más activas: notificar y crear extensión si quedan cupos;
 * 6) si nada aplica: preguntar al usuario con candidatas, de la más antigua a la más reciente.
 */
export function decideSlot(
  sessionId: string,
  slots: SlotInfo[],
  now: number,
  cfg: PoolConfig,
  opts: { allowOverflow?: boolean } = {},
): SlotDecision {
  const usable = slots.filter((s) => !s.quarantined);

  const own = usable.find((s) => s.sessionId === sessionId);
  if (own) return { kind: "reuse", slot: own.slot };

  const free = usable.filter((s) => !s.sessionId);
  const freeBase = free.filter((s) => !s.overflow).sort(byOldestFirst);
  const freeAny = freeBase.length > 0 ? freeBase : free.sort(byOldestFirst);
  if (freeAny.length > 0) return { kind: "free", slot: freeAny[0].slot };

  const baseCount = slots.filter((s) => !s.overflow).length;
  const overflowCount = slots.filter((s) => s.overflow).length;
  const activeCount = usable.filter((s) => isActiveSlot(s, now, cfg)).length;
  const notify: string[] = [];
  if (activeCount < cfg.poolMax && baseCount < cfg.poolMax) {
    return { kind: "create", slot: nextSlotId(slots, false), overflow: false, notify };
  }

  // Reciclar elegibles no cuesta cupo: no son activas.
  const eligible = usable.filter((s) => isRecycleEligible(s, now, cfg));
  const eligibleBase = eligible.filter((s) => !s.overflow).sort(byOldestFirst);
  const eligibleAny = eligibleBase.length > 0 ? eligibleBase : eligible.sort(byOldestFirst);
  if (eligibleAny.length > 0) {
    const pick = eligibleAny[0];
    if (activeCount >= cfg.poolMax) notify.push(`Ya hay ${cfg.poolMax} sesiones activas ejecutando al mismo tiempo (${activeCount} activas).`);
    return { kind: "recycle", slot: pick.slot, previousSessionId: pick.sessionId, notify };
  }

  if (activeCount >= cfg.poolMax) {
    notify.push(`Ya hay ${cfg.poolMax} sesiones activas ejecutando al mismo tiempo (${activeCount} activas).`);
    if (opts.allowOverflow && overflowCount < cfg.overflowMax) {
      notify.push(`Extensión ${overflowCount + 1}/${cfg.overflowMax} en uso (confirmada por el usuario).`);
      return { kind: "create", slot: nextSlotId(slots, true), overflow: true, notify };
    }
    if (!opts.allowOverflow) {
      notify.push(`Para extender el pool hay que confirmar (extensión 1/${cfg.overflowMax}); o esperar a que termine una de las sesiones activas.`);
    }
  }

  const candidates = usable.filter((s) => s.sessionId).sort(byOldestFirst);
  notify.push("No hay cupo: elegí una sesión para sustituir o cancelá (sin respuesta no se cambia nada).");
  return { kind: "ask", candidates, notify };
}

/** Siguiente id libre: `pool-NN` base (01..10) o extensión (11..15). */
export function nextSlotId(slots: SlotInfo[], overflow: boolean): string {
  const taken = new Set(slots.map((s) => s.slot));
  const start = overflow ? 11 : 1;
  for (let n = start; n < start + 100; n++) {
    const id = `pool-${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("no hay ids de slot disponibles");
}

/** Revisión monotónica al reciclar: continúa desde la del slot, nunca retrocede. */
/**
 * Extrae el título de una sesión de la salida JSON de `opencode session list --format json`.
 * Devuelve null si no existe, si el título está vacío o si OpenCode lo dejó como "Untitled session".
 */
export function parseSessionListTitle(json: string, sessionId: string): string | null {
  let rows: unknown;
  try { rows = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r: any) => r && r.id === sessionId) as { title?: unknown } | undefined;
  if (!row || typeof row.title !== "string") return null;
  const title = row.title.trim();
  if (!title || title === "Untitled session") return null;
  return title.slice(0, 120);
}

export function nextRevision(previousRevision: number): number {
  return Math.max(0, Math.floor(previousRevision)) + 1;
}
