/**
 * session-slots — mirror (JS) de src/session-slots.ts
 * Generado desde src/session-slots.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

export const TERMINAL_REQUEST_STATES = ["DONE", "ABANDONED"];
export const POOL_DEFAULTS = {
  poolMax: 10,
  overflowMax: 5,
  activeMinutes: 15,
  recycleDays: 7
};
export function parsePoolConfig(env = process.env) {
  const num = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    poolMax: Math.floor(num(env.OSTACKY_SESSION_POOL_MAX, POOL_DEFAULTS.poolMax)),
    overflowMax: Math.floor(num(env.OSTACKY_SESSION_OVERFLOW_MAX, POOL_DEFAULTS.overflowMax)),
    activeMs: num(env.OSTACKY_SESSION_ACTIVE_MIN, POOL_DEFAULTS.activeMinutes) * 60000,
    recycleMs: num(env.OSTACKY_SESSION_RECYCLE_DAYS, POOL_DEFAULTS.recycleDays) * 86400000
  };
}
export function isActiveSlot(s, now, cfg) {
  if (!s.sessionId || !s.requestId || s.quarantined)
    return false;
  if (s.state && TERMINAL_REQUEST_STATES.includes(s.state))
    return false;
  return s.ownerHeartbeat > 0 && now - s.ownerHeartbeat <= cfg.activeMs;
}
export function isRecycleEligible(s, now, cfg) {
  if (s.quarantined)
    return false;
  const terminal = !s.requestId || !!s.state && TERMINAL_REQUEST_STATES.includes(s.state);
  if (!terminal)
    return false;
  return now - s.lastUsedAt > cfg.recycleMs;
}
const byOldestFirst = (a, b) => a.lastUsedAt - b.lastUsedAt || a.slot.localeCompare(b.slot);
export function decideSlot(sessionId, slots, now, cfg, opts = {}) {
  const usable = slots.filter((s) => !s.quarantined);
  const own = usable.find((s) => s.sessionId === sessionId);
  if (own)
    return { kind: "reuse", slot: own.slot };
  const free = usable.filter((s) => !s.sessionId);
  const freeBase = free.filter((s) => !s.overflow).sort(byOldestFirst);
  const freeAny = freeBase.length > 0 ? freeBase : free.sort(byOldestFirst);
  if (freeAny.length > 0)
    return { kind: "free", slot: freeAny[0].slot };
  const baseCount = slots.filter((s) => !s.overflow).length;
  const overflowCount = slots.filter((s) => s.overflow).length;
  const activeCount = usable.filter((s) => isActiveSlot(s, now, cfg)).length;
  const notify = [];
  if (activeCount < cfg.poolMax && baseCount < cfg.poolMax) {
    return { kind: "create", slot: nextSlotId(slots, false), overflow: false, notify };
  }
  const eligible = usable.filter((s) => isRecycleEligible(s, now, cfg));
  const eligibleBase = eligible.filter((s) => !s.overflow).sort(byOldestFirst);
  const eligibleAny = eligibleBase.length > 0 ? eligibleBase : eligible.sort(byOldestFirst);
  if (eligibleAny.length > 0) {
    const pick = eligibleAny[0];
    if (activeCount >= cfg.poolMax)
      notify.push(`Ya hay ${cfg.poolMax} sesiones activas ejecutando al mismo tiempo (${activeCount} activas).`);
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
export function nextSlotId(slots, overflow) {
  const taken = new Set(slots.map((s) => s.slot));
  const start = overflow ? 11 : 1;
  for (let n = start;n < start + 100; n++) {
    const id = `pool-${String(n).padStart(2, "0")}`;
    if (!taken.has(id))
      return id;
  }
  throw new Error("no hay ids de slot disponibles");
}
export function parseSessionListTitle(json, sessionId) {
  let rows;
  try {
    rows = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rows))
    return null;
  const row = rows.find((r) => r && r.id === sessionId);
  if (!row || typeof row.title !== "string")
    return null;
  const title = row.title.trim();
  if (!title || title === "Untitled session")
    return null;
  return title.slice(0, 120);
}
export function nextRevision(previousRevision) {
  return Math.max(0, Math.floor(previousRevision)) + 1;
}
