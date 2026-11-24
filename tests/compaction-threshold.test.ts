import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contextTokens,
  effectiveThreshold,
  parseCompactConfig,
  shouldCompact,
  compactDecision,
  resolveCompactConfig,
  loadCompactConfig,
} from "../src/compaction-threshold.ts";

/** Config activa explícita: el default pasó a `false` (opt-in). */
const ON = parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "true" });

describe("compaction-threshold", () => {
  it("normaliza tokens por proveedor (Anthropic suma cache)", () => {
    const t = { input: 1000, output: 500, reasoning: 100, cache: { read: 200, write: 50 } };
    expect(contextTokens(t, "anthropic")).toBe(1850);
    // OpenAI no suma cache.read (puede estar en input)
    expect(contextTokens(t, "openai")).toBe(1650);
  });

  it("parseCompactConfig defaults: desactivada y modo off", () => {
    const cfg = parseCompactConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode).toBe("off");
    expect(cfg.threshold).toBe(120000);
  });

  it("solo \"true\" activa (mayúsculas y espacios tolerados)", () => {
    expect(parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "true" }).enabled).toBe(true);
    expect(parseCompactConfig({ OSTACKY_COMPACT_ENABLED: " TRUE " }).enabled).toBe(true);
    expect(parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "1" }).enabled).toBe(false);
    expect(parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "false" }).enabled).toBe(false);
  });

  it("effectiveThreshold es fijo, independiente del modelo", () => {
    expect(effectiveThreshold(ON)).toBe(120000);
  });

  it("zonas: free/warn/opportunity", () => {
    expect(compactDecision(50000, ON).zone).toBe("free");
    expect(compactDecision(105000, ON).zone).toBe("warn");
    expect(compactDecision(120000, ON).zone).toBe("opportunity");
  });

  it("no compacta por debajo del umbral mínimo (120k)", () => {
    expect(compactDecision(119999, ON).compact).toBe(false);
  });

  it("el umbral no cambia aunque se informe una ventana (no hay dependencia del modelo)", () => {
    const d = compactDecision(100000, ON, { windowTokens: 100000 } as any);
    expect(d.effectiveThreshold).toBe(120000);
    expect(d.zone).toBe("warn");
    expect(d.compact).toBe(false);
  });

  it("tarea compleja por encima del umbral: nunca se corta, se difiere al siguiente punto seguro", () => {
    for (const tokens of [120000, 200000, 500000]) {
      const d = compactDecision(tokens, ON, { complexTaskInProgress: true });
      expect(d.compact).toBe(false);
      expect(d.deferred).toBe(true);
    }
  });

  it("en punto seguro por encima del umbral se compacta", () => {
    const d = compactDecision(120000, ON, { complexTaskInProgress: false });
    expect(d.compact).toBe(true);
    expect(d.deferred).toBe(false);
  });

  it("anti-reentrada", () => {
    const d = compactDecision(120000, ON, { inFlight: true });
    expect(d.compact).toBe(false);
  });

  it("cooldown", () => {
    const now = Date.now();
    const d = compactDecision(120000, ON, { lastCompactTs: now - 1000, cooldownMs: 10000, now });
    expect(d.compact).toBe(false);
  });

  it("disabled", () => {
    const cfg = parseCompactConfig({ OSTACKY_COMPACT_ENABLED: "false" });
    expect(cfg.enabled).toBe(false);
    expect(shouldCompact(200000, cfg)).toBe(false);
    expect(effectiveThreshold(cfg)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("compaction-threshold — prioridad de configuración", () => {
  it("process.env gana al archivo del proyecto", () => {
    const r = resolveCompactConfig({
      env: { OSTACKY_COMPACT_ENABLED: "false" },
      project: { compaction: { enabled: true } },
    });
    expect(r.cfg.enabled).toBe(false);
    expect(r.origin).toBe("env");
  });

  it("el archivo del proyecto gana al global (campo por campo)", () => {
    const r = resolveCompactConfig({
      env: {},
      project: { compaction: { enabled: true, threshold: 90_000 } },
      global: { compaction: { enabled: false, threshold: 50_000, model: "anthropic/claude" } },
    });
    expect(r.cfg.enabled).toBe(true);
    expect(r.cfg.threshold).toBe(90_000);
    // el proyecto no define model: lo aporta el global
    expect(r.cfg.model).toBe("anthropic/claude");
    expect(r.origin).toBe("project");
  });

  it("sin configuración explícita: desactivada y origen default", () => {
    const r = resolveCompactConfig({ env: {}, project: undefined, global: undefined });
    expect(r.cfg).toMatchObject({ enabled: false, mode: "off", threshold: 120_000 });
    expect(r.origin).toBe("default");
    expect(r.warnings).toEqual([]);
  });

  it("campo con tipo inválido se ignora y avisa", () => {
    const r = resolveCompactConfig({ env: {}, project: { compaction: { enabled: "sí", threshold: -5 } } });
    expect(r.cfg.enabled).toBe(false);
    expect(r.cfg.threshold).toBe(120_000);
    expect(r.warnings.some((w) => w.includes("enabled"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("threshold"))).toBe(true);
  });

  it("archivo del proyecto ilegible: defaults sin lanzar, con aviso", () => {
    const root = mkdtempSync(join(tmpdir(), "ostacky-compact-cfg-"));
    try {
      mkdirSync(join(root, ".opencode"), { recursive: true });
      writeFileSync(join(root, ".opencode", "ostacky-controller.json"), "{ no es json");
      const r = loadCompactConfig(root, { env: {}, home: join(root, "home") });
      expect(r.cfg.enabled).toBe(false);
      expect(r.origin).toBe("default");
      expect(r.warnings.some((w) => w.includes("no se pudo parsear"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("archivo del proyecto válido activa; ausente no rompe", () => {
    const root = mkdtempSync(join(tmpdir(), "ostacky-compact-cfg-"));
    try {
      const home = join(root, "home");
      const empty = loadCompactConfig(root, { env: {}, home });
      expect(empty.cfg.enabled).toBe(false);
      expect(empty.origin).toBe("default");

      mkdirSync(join(root, ".opencode"), { recursive: true });
      writeFileSync(join(root, ".opencode", "ostacky-controller.json"), JSON.stringify({ compaction: { enabled: true, mode: "warn", threshold: 200_000 } }));
      const on = loadCompactConfig(root, { env: {}, home });
      expect(on.cfg).toMatchObject({ enabled: true, mode: "warn", threshold: 200_000 });
      expect(on.origin).toBe("project");
      expect(on.paths.project).toBe(join(root, ".opencode", "ostacky-controller.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
