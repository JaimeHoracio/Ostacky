import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  contextTokens,
  effectiveThreshold,
  parseCompactConfig,
  shouldCompact,
  compactDecision,
} from "../src/compaction-threshold.ts";

describe("compaction-threshold", () => {
  it("normaliza tokens por proveedor (Anthropic suma cache)", () => {
    const t = { input: 1000, output: 500, reasoning: 100, cache: { read: 200, write: 50 } };
    expect(contextTokens(t, "anthropic")).toBe(1850);
    // OpenAI no suma cache.read (puede estar en input)
    expect(contextTokens(t, "openai")).toBe(1650);
  });

  it("parseCompactConfig defaults", () => {
    const cfg = parseCompactConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("warn");
    expect(cfg.threshold).toBe(120000);
  });

  it("effectiveThreshold es fijo, independiente del modelo", () => {
    const cfg = parseCompactConfig({});
    expect(effectiveThreshold(cfg)).toBe(120000);
  });

  it("zonas: free/warn/opportunity", () => {
    const cfg = parseCompactConfig({});
    expect(compactDecision(50000, cfg).zone).toBe("free");
    expect(compactDecision(105000, cfg).zone).toBe("warn");
    expect(compactDecision(120000, cfg).zone).toBe("opportunity");
  });

  it("no compacta por debajo del umbral mínimo (120k)", () => {
    const cfg = parseCompactConfig({});
    expect(compactDecision(119999, cfg).compact).toBe(false);
  });

  it("el umbral no cambia aunque se informe una ventana (no hay dependencia del modelo)", () => {
    const cfg = parseCompactConfig({});
    const d = compactDecision(100000, cfg, { windowTokens: 100000 } as any);
    expect(d.effectiveThreshold).toBe(120000);
    expect(d.zone).toBe("warn");
    expect(d.compact).toBe(false);
  });

  it("tarea compleja por encima del umbral: nunca se corta, se difiere al siguiente punto seguro", () => {
    const cfg = parseCompactConfig({});
    for (const tokens of [120000, 200000, 500000]) {
      const d = compactDecision(tokens, cfg, { complexTaskInProgress: true });
      expect(d.compact).toBe(false);
      expect(d.deferred).toBe(true);
    }
  });

  it("en punto seguro por encima del umbral se compacta", () => {
    const cfg = parseCompactConfig({});
    const d = compactDecision(120000, cfg, { complexTaskInProgress: false });
    expect(d.compact).toBe(true);
    expect(d.deferred).toBe(false);
  });

  it("anti-reentrada", () => {
    const cfg = parseCompactConfig({});
    const d = compactDecision(120000, cfg, { inFlight: true });
    expect(d.compact).toBe(false);
  });

  it("cooldown", () => {
    const cfg = parseCompactConfig({});
    const now = Date.now();
    const d = compactDecision(120000, cfg, { lastCompactTs: now - 1000, cooldownMs: 10000, now });
    expect(d.compact).toBe(false);
  });

  it("disabled", () => {
    const cfg = parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "false" });
    expect(cfg.enabled).toBe(false);
    expect(shouldCompact(200000, cfg)).toBe(false);
  });
});
