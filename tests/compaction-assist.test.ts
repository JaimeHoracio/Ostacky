import { describe, expect, it } from "bun:test";
import {
  ASSIST_MAX_RETRIES,
  isSafePointState,
  assistBlocksTools,
  assistInit,
  canRetryCompaction,
  compactionEnded,
  compactionFailed,
  compactionStarted,
  continueSession,
  crossesThreshold,
  markAsked,
  recordMeasurement,
  requestCompaction,
  shouldAsk,
} from "../src/compaction-assist.ts";

const THRESHOLD = 120_000;
const opts = { threshold: THRESHOLD, safePoint: true } as const;

describe("compaction-assist — medición", () => {
  it("no acumula: dos mediciones dan la última, no la suma", () => {
    let s = assistInit();
    s = recordMeasurement(s, { tokens: 80_000, now: 1 });
    s = recordMeasurement(s, { tokens: 90_000, now: 2 });
    expect(s.tokens).toBe(90_000);
    expect(s.prevTokens).toBe(80_000);
    expect(s.stale).toBe(false);
  });

  it("una medición nueva reactiva la evaluación tras quedar stale", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = compactionEnded(s);
    expect(s.stale).toBe(true);
    expect(shouldAsk(s, opts)).toBe(false);
    s = recordMeasurement(s, { tokens: 140_000 });
    expect(s.stale).toBe(false);
    // venía de 130k (por encima): no es un cruce nuevo
    expect(shouldAsk(s, opts)).toBe(false);
  });
});

describe("compaction-assist — pregunta única", () => {
  it("cruza el umbral en punto seguro: corresponde preguntar", () => {
    const s = recordMeasurement(assistInit(), { tokens: 125_000 });
    expect(shouldAsk(s, opts)).toBe(true);
  });

  it("una sola pregunta: mientras está pendiente no se repite", () => {
    let s = recordMeasurement(assistInit(), { tokens: 125_000 });
    s = markAsked(s);
    expect(assistBlocksTools(s)).toBe(true);
    expect(shouldAsk(s, opts)).toBe(false);
    s = recordMeasurement(s, { tokens: 150_000 });
    expect(s.phase).toBe("pending");
    expect(shouldAsk(s, opts)).toBe(false);
  });

  it("no pregunta fuera de un punto seguro ni por debajo del umbral", () => {
    const below = recordMeasurement(assistInit(), { tokens: 119_999 });
    expect(shouldAsk(below, opts)).toBe(false);
    const above = recordMeasurement(assistInit(), { tokens: 130_000 });
    expect(shouldAsk(above, { threshold: THRESHOLD, safePoint: false })).toBe(false);
  });

  it("no pregunta con opt-out ni con el mecanismo desactivado", () => {
    const s = recordMeasurement(assistInit(), { tokens: 130_000 });
    expect(shouldAsk(s, { ...opts, optOut: true })).toBe(false);
    expect(shouldAsk(s, { ...opts, enabled: false })).toBe(false);
  });

  it("cooldown tras compactar", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = requestCompaction(s, 10_000);
    s = compactionEnded(s);
    s = recordMeasurement(s, { tokens: 100_000 });
    s = recordMeasurement(s, { tokens: 130_000 });
    expect(shouldAsk(s, { threshold: THRESHOLD, safePoint: true, cooldownMs: 60_000, now: 20_000 })).toBe(false);
    expect(shouldAsk(s, { threshold: THRESHOLD, safePoint: true, cooldownMs: 60_000, now: 90_000 })).toBe(true);
  });

  it("crossesThreshold: primera medición cuenta como cruce, bajar y volver a subir también", () => {
    expect(crossesThreshold(null, 130_000, THRESHOLD)).toBe(true);
    expect(crossesThreshold(119_000, 120_000, THRESHOLD)).toBe(true);
    expect(crossesThreshold(130_000, 140_000, THRESHOLD)).toBe(false);
    expect(crossesThreshold(130_000, 100_000, THRESHOLD)).toBe(false);
  });
});

describe("compaction-assist — decisión del usuario", () => {
  it("Continuar libera el gate y no vuelve a preguntar hasta un nuevo cruce", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = markAsked(s);
    s = continueSession(s);
    expect(s.phase).toBe("idle");
    expect(assistBlocksTools(s)).toBe(false);
    s = recordMeasurement(s, { tokens: 160_000 });
    expect(shouldAsk(s, opts)).toBe(false);
    // baja el contexto (p. ej. compactación nativa) y vuelve a cruzar
    s = recordMeasurement(s, { tokens: 20_000 });
    s = recordMeasurement(s, { tokens: 130_000 });
    expect(shouldAsk(s, opts)).toBe(true);
  });

  it("Compactar deja el estado en compacting, no en compactado", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = markAsked(s);
    s = requestCompaction(s, 1_000);
    expect(s.phase).toBe("compacting");
    expect(assistBlocksTools(s)).toBe(false);
    expect(shouldAsk(s, opts)).toBe(false);
  });

  it("una compactación pedida por fuera también bloquea la pregunta", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = compactionStarted(s, 500);
    expect(s.phase).toBe("compacting");
    expect(shouldAsk(s, opts)).toBe(false);
  });

  it("terminada: vuelve a idle con la medición stale (nunca tokens: 0)", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = requestCompaction(s, 1_000);
    s = compactionEnded(s);
    expect(s.phase).toBe("stale");
    expect(s.stale).toBe(true);
    expect(s.tokens).toBe(130_000);
    expect(shouldAsk(s, opts)).toBe(false);
  });

  it("fallo: libera el gate, registra el error y no reintenta más de una vez", () => {
    let s = recordMeasurement(assistInit(), { tokens: 130_000 });
    s = requestCompaction(s, 1_000);
    s = compactionFailed(s, new Error("boom"), 2_000);
    expect(s.phase).toBe("idle");
    expect(assistBlocksTools(s)).toBe(false);
    expect(s.lastError).toBe("boom");
    expect(canRetryCompaction(s)).toBe(true);
    s = requestCompaction(s, 3_000);
    s = compactionFailed(s, "segundo fallo", 4_000);
    expect(s.retries).toBe(2);
    expect(canRetryCompaction(s)).toBe(false);
    expect(s.lastError).toBe("segundo fallo");
  });

  it("el reintento máximo es 1", () => {
    expect(ASSIST_MAX_RETRIES).toBe(1);
  });
});

describe("compaction-assist: respuesta por ostacky_compact_decision (D6)", () => {
  // Transiciones que el tool `ostacky_compact_decision` aplica sobre el estado pendiente.
  const pending = () => markAsked(recordMeasurement(assistInit(), { tokens: 125_000 }));

  it("continue libera el gate sin volver a preguntar en este cruce", () => {
    const s = continueSession(pending());
    expect(assistBlocksTools(s)).toBe(false);
    expect(s.phase).toBe("idle");
    // sigue por encima del umbral: no es un cruce nuevo, no vuelve a preguntar
    const next = recordMeasurement(s, { tokens: 130_000 });
    expect(shouldAsk(next, opts)).toBe(false);
  });

  it("opt-out libera el gate y no vuelve a preguntar aunque se cruce otra vez", () => {
    const s = continueSession(pending());
    expect(assistBlocksTools(s)).toBe(false);
    const again = recordMeasurement(recordMeasurement(s, { tokens: 100_000 }), { tokens: 130_000 });
    expect(shouldAsk(again, { ...opts, optOut: true })).toBe(false);
  });

  it("compact no bloquea escrituras mientras compacta y libera al terminar", () => {
    const s = requestCompaction(pending(), 10_000);
    expect(s.phase).toBe("compacting");
    expect(assistBlocksTools(s)).toBe(false);
    const done = compactionEnded(s);
    expect(done.phase).not.toBe("pending");
    expect(assistBlocksTools(done)).toBe(false);
  });

  it("pendiente bloquea herramientas mutantes hasta la decisión", () => {
    expect(assistBlocksTools(pending())).toBe(true);
  });
});

describe("compaction-assist: tarea compleja en curso se difiere (spec)", () => {
  it("EXECUTING_* no es punto seguro; el resto sí", () => {
    expect(isSafePointState("EXECUTING_INLINE")).toBe(false);
    expect(isSafePointState("EXECUTING_SUBAGENTS")).toBe(false);
    expect(isSafePointState("DONE")).toBe(true);
    expect(isSafePointState(null)).toBe(true);
  });
  it("sobre el umbral durante ejecución no pregunta; en el siguiente idle sí", () => {
    const s = recordMeasurement(assistInit(), { tokens: 130_000 });
    const base = { threshold: 120_000, enabled: true, optOut: false, cooldownMs: 0, now: Date.now() };
    expect(shouldAsk(s, { ...base, safePoint: isSafePointState("EXECUTING_INLINE") })).toBe(false);
    expect(shouldAsk(s, { ...base, safePoint: isSafePointState("DONE") })).toBe(true);
  });
});
