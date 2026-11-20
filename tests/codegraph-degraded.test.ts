import { describe, expect, it } from "bun:test";
import {
  codegraphDegradedTtlMs,
  codegraphMode,
  isCodegraphGateActive,
  marksCodegraphFailure,
  shouldBlockCodeRead,
  CODEGRAPH_DEGRADED_TTL_MIN_DEFAULT,
} from "../assets/plugins/ostacky-controller/index.ts";

const MIN = 60_000;
const base = { mode: "auto" as const, available: true, degradedSince: null, now: 10 * MIN, ttlMs: 30 * MIN };

describe("codegraph-degraded-mode — modo", () => {
  it("default auto; strict y off explícitos; valor inválido → auto", () => {
    expect(codegraphMode({})).toBe("auto");
    expect(codegraphMode({ OSTACKY_CODEGRAPH: "STRICT" })).toBe("strict");
    expect(codegraphMode({ OSTACKY_CODEGRAPH: " off " })).toBe("off");
    expect(codegraphMode({ OSTACKY_CODEGRAPH: "loose" })).toBe("auto");
  });

  it("TTL configurable; inválido o no positivo → default", () => {
    expect(codegraphDegradedTtlMs({})).toBe(CODEGRAPH_DEGRADED_TTL_MIN_DEFAULT * MIN);
    expect(codegraphDegradedTtlMs({ OSTACKY_CODEGRAPH_DEGRADED_TTL_MIN: "5" })).toBe(5 * MIN);
    expect(codegraphDegradedTtlMs({ OSTACKY_CODEGRAPH_DEGRADED_TTL_MIN: "0" })).toBe(CODEGRAPH_DEGRADED_TTL_MIN_DEFAULT * MIN);
    expect(codegraphDegradedTtlMs({ OSTACKY_CODEGRAPH_DEGRADED_TTL_MIN: "abc" })).toBe(CODEGRAPH_DEGRADED_TTL_MIN_DEFAULT * MIN);
  });
});

describe("codegraph-degraded-mode — qué cuenta como fallo", () => {
  it("solo fallos reales de codegraph_explore", () => {
    expect(marksCodegraphFailure("codegraph_codegraph_explore", "error")).toBe(true);
    expect(marksCodegraphFailure("codegraph_codegraph_explore", "timeout")).toBe(true);
    expect(marksCodegraphFailure("codegraph_codegraph_explore", "completed")).toBe(false);
    expect(marksCodegraphFailure("codegraph_codegraph_search", "error")).toBe(false);
    expect(marksCodegraphFailure("read", "error")).toBe(false);
  });
});

describe("codegraph-degraded-mode — gate activo", () => {
  it("auto sano con binario → gate activo (estricto, como hoy)", () => {
    expect(isCodegraphGateActive(base)).toBe(true);
  });

  it("sin binario/PATH → gate inactivo en cualquier modo", () => {
    expect(isCodegraphGateActive({ ...base, available: false })).toBe(false);
    expect(isCodegraphGateActive({ ...base, mode: "strict", available: false })).toBe(false);
  });

  it("off → inactivo aunque haya binario", () => {
    expect(isCodegraphGateActive({ ...base, mode: "off" })).toBe(false);
  });

  it("auto degradado dentro del TTL → inactivo (el Read pasa)", () => {
    expect(isCodegraphGateActive({ ...base, degradedSince: 5 * MIN })).toBe(false);
  });

  it("auto degradado con TTL vencido → vuelve a activo", () => {
    expect(isCodegraphGateActive({ ...base, degradedSince: 0, now: 30 * MIN })).toBe(true);
  });

  it("strict ignora la degradación", () => {
    expect(isCodegraphGateActive({ ...base, mode: "strict", degradedSince: 5 * MIN })).toBe(true);
  });
});

describe("codegraph-degraded-mode — invariante end-to-end con el gate de lectura", () => {
  const codeRead = { isCodeFile: true, isLiteralGrep: false, isSpecTasksPath: false, isDocsPath: false, isTaskTracked: false };

  it("MCP caído con binario: explore falla → Read permitido sin discovery", () => {
    const gateActive = isCodegraphGateActive({ ...base, degradedSince: 5 * MIN });
    expect(shouldBlockCodeRead({ ...codeRead, codegraphOk: gateActive, hasDiscoveryHit: false })).toBe(false);
  });

  it("sin degradación: sin discovery → bloquea (regresión del gate estricto)", () => {
    const gateActive = isCodegraphGateActive(base);
    expect(shouldBlockCodeRead({ ...codeRead, codegraphOk: gateActive, hasDiscoveryHit: false })).toBe(true);
  });
});
