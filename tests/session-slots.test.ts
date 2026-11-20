import { describe, expect, it } from "bun:test";
import {
  decideSlot,
  isActiveSlot,
  isRecycleEligible,
  nextRevision,
  nextSlotId,
  parsePoolConfig,
  type PoolConfig,
  type SlotInfo,
} from "../src/session-slots.ts";

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = 100 * DAY;
const cfg: PoolConfig = { poolMax: 10, overflowMax: 5, activeMs: 15 * MIN, recycleMs: 7 * DAY };

function slot(n: number, patch: Partial<SlotInfo> = {}): SlotInfo {
  const id = `pool-${String(n).padStart(2, "0")}`;
  return {
    slot: id, overflow: n > 10, quarantined: false, sessionId: null, requestId: null,
    state: null, ownerHeartbeat: 0, lastUsedAt: NOW - 30 * DAY, ...patch,
  };
}
const active = (n: number, sid = `s${n}`) =>
  slot(n, { sessionId: sid, requestId: `req-${n}`, state: "EXECUTING_INLINE", ownerHeartbeat: NOW - MIN, lastUsedAt: NOW - MIN });
const terminal = (n: number, daysAgo: number) =>
  slot(n, { sessionId: `old${n}`, requestId: `r${n}`, state: "DONE", ownerHeartbeat: NOW - daysAgo * DAY, lastUsedAt: NOW - daysAgo * DAY });
const fullActive = () => Array.from({ length: 10 }, (_, i) => active(i + 1));

describe("session-slots — configuración", () => {
  it("defaults y sobrescritura por env; inválido → default", () => {
    const d = parsePoolConfig({});
    expect(d).toEqual({ poolMax: 10, overflowMax: 5, activeMs: 15 * MIN, recycleMs: 7 * DAY });
    const o = parsePoolConfig({
      OSTACKY_SESSION_POOL_MAX: "4", OSTACKY_SESSION_OVERFLOW_MAX: "2",
      OSTACKY_SESSION_ACTIVE_MIN: "5", OSTACKY_SESSION_RECYCLE_DAYS: "1",
    });
    expect(o).toEqual({ poolMax: 4, overflowMax: 2, activeMs: 5 * MIN, recycleMs: DAY });
    expect(parsePoolConfig({ OSTACKY_SESSION_POOL_MAX: "abc" }).poolMax).toBe(10);
    expect(parsePoolConfig({ OSTACKY_SESSION_POOL_MAX: "0" }).poolMax).toBe(10);
  });
});

describe("session-slots — actividad y elegibilidad", () => {
  it("activa = request no terminal con heartbeat dentro de la ventana", () => {
    expect(isActiveSlot(active(1), NOW, cfg)).toBe(true);
    expect(isActiveSlot({ ...active(1), ownerHeartbeat: NOW - 20 * MIN }, NOW, cfg)).toBe(false);
    expect(isActiveSlot({ ...active(1), state: "DONE" }, NOW, cfg)).toBe(false);
    expect(isActiveSlot(slot(1), NOW, cfg)).toBe(false);
  });

  it("elegible = terminal o sin request, no activa, sin uso hace más de N días", () => {
    expect(isRecycleEligible(terminal(1, 8), NOW, cfg)).toBe(true);
    expect(isRecycleEligible(terminal(1, 3), NOW, cfg)).toBe(false);
    expect(isRecycleEligible(slot(1, { lastUsedAt: NOW - 8 * DAY }), NOW, cfg)).toBe(true);
    expect(isRecycleEligible({ ...terminal(1, 8), state: "EXECUTING_INLINE" }, NOW, cfg)).toBe(false);
    expect(isRecycleEligible({ ...terminal(1, 8), quarantined: true }, NOW, cfg)).toBe(false);
  });
});

describe("session-slots — decideSlot", () => {
  it("reutiliza el slot propio", () => {
    expect(decideSlot("s2", [slot(1), active(2)], NOW, cfg)).toEqual({ kind: "reuse", slot: "pool-02" });
  });

  it("usa un slot libre base antes que uno de extensión", () => {
    const slots = [active(1), slot(2), slot(11, { overflow: true })];
    expect(decideSlot("nueva", slots, NOW, cfg)).toEqual({ kind: "free", slot: "pool-02" });
  });

  it("crea un slot base cuando no hay libres y hay tope disponible", () => {
    const d = decideSlot("nueva", [active(1), active(2)], NOW, cfg);
    expect(d).toMatchObject({ kind: "create", slot: "pool-03", overflow: false });
  });

  it("usa un slot libre antes de reciclar aunque haya elegibles", () => {
    const slots = [active(1), terminal(2, 9), terminal(3, 20), slot(4), active(5), active(6), active(7), active(8), active(9), active(10)];
    const d = decideSlot("nueva", slots, NOW, cfg);
    expect(d.kind).toBe("free");
  });

  it("con 10 activas notifica y crea extensión 1/5 (sin reciclar activas)", () => {
    const d = decideSlot("nueva", fullActive(), NOW, cfg);
    expect(d).toMatchObject({ kind: "create", slot: "pool-11", overflow: true });
    if (d.kind === "create") {
      expect(d.notify[0]).toContain("Ya hay 10 sesiones activas");
      expect(d.notify[1]).toContain("Extensión 1/5");
    }
  });

  it("con 10 activas y extensión agotada (5) pregunta con candidatas de la más antigua", () => {
    const ext = Array.from({ length: 5 }, (_, i) => active(11 + i, `x${i}`));
    const slots = [...fullActive(), ...ext].map((s, i) => ({ ...s, lastUsedAt: NOW - (i + 1) * MIN }));
    const d = decideSlot("nueva", slots, NOW, cfg);
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") {
      expect(d.candidates[0].slot).toBe("pool-15");
      expect(d.candidates.length).toBe(15);
      expect(d.notify.join(" ")).toContain("sin respuesta no se cambia nada");
    }
  });

  it("pool lleno sin elegibles y sin activas que superen el tope: pregunta, no crea", () => {
    const stale = Array.from({ length: 10 }, (_, i) =>
      slot(i + 1, { sessionId: `z${i}`, requestId: `r${i}`, state: "EXECUTING_INLINE", ownerHeartbeat: NOW - 60 * MIN, lastUsedAt: NOW - (i + 1) * DAY }),
    );
    const d = decideSlot("nueva", stale, NOW, cfg);
    expect(d.kind).toBe("ask");
  });

  it("reciclaje de elegible con pool completo y activas por debajo del tope", () => {
    const slots = [terminal(1, 20), terminal(2, 9), ...Array.from({ length: 8 }, (_, i) => active(i + 3))];
    const d = decideSlot("nueva", slots, NOW, cfg);
    expect(d).toMatchObject({ kind: "recycle", slot: "pool-01", previousSessionId: "old1" });
  });

  it("slots en cuarentena no cuentan como libres ni se reutilizan", () => {
    const slots = [slot(1, { quarantined: true }), active(2)];
    expect(decideSlot("nueva", slots, NOW, cfg)).toMatchObject({ kind: "create", slot: "pool-03" });
  });
});

describe("session-slots — ids y revisión", () => {
  it("nextSlotId: base 01..10 y extensión 11..15", () => {
    expect(nextSlotId([slot(1), slot(3)], false)).toBe("pool-02");
    expect(nextSlotId([slot(11)], true)).toBe("pool-12");
  });

  it("revisión monotónica al reciclar: siempre mayor que la anterior", () => {
    expect(nextRevision(0)).toBe(1);
    expect(nextRevision(41)).toBe(42);
    expect(nextRevision(-3)).toBe(1);
  });
});
