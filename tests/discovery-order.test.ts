import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isCodeReadGated, shouldBlockCodeRead, shouldBlockDiscoveryTool, isCodegraphGateActive,
  marksCodegraphFailure, marksEngramFailure, staticDirOf, discoveryCoversArea, isNotIndexedOutput,
  isEmptyExploreResult, discoveryLoopNext, DISCOVERY_LOOP_THRESHOLD, engramDegraded,
  shouldBlockEngramEdit, engramDegradedTtlMs, shellReadTargets,
} from "../assets/plugins/ostacky-controller/index.ts"

const base = { isCodeFile: true, isLiteralGrep: false, isSpecTasksPath: false, isDocsPath: false, isTaskTracked: false }

describe("discovery-order: Glob/Grep sobre código (predicado)", () => {
  it("glob sobre código sin discovery → no_discovery", () => {
    expect(shouldBlockDiscoveryTool({ ...base, codegraphOk: true, hasDiscoveryHit: false, areaCovered: false })).toBe("no_discovery")
  })
  it("grep de literal exento", () => {
    expect(shouldBlockDiscoveryTool({ ...base, isLiteralGrep: true, codegraphOk: true, hasDiscoveryHit: false, areaCovered: false })).toBeNull()
  })
  it("docs y specs exentos", () => {
    expect(shouldBlockDiscoveryTool({ ...base, isSpecTasksPath: true, codegraphOk: true, hasDiscoveryHit: false, areaCovered: false })).toBeNull()
    expect(shouldBlockDiscoveryTool({ ...base, isDocsPath: true, codegraphOk: true, hasDiscoveryHit: false, areaCovered: false })).toBeNull()
  })
  it("gate inactivo (CodeGraph off/degradado) → permitido", () => {
    expect(shouldBlockDiscoveryTool({ ...base, codegraphOk: false, hasDiscoveryHit: false, areaCovered: false })).toBeNull()
  })
  it("explore del área correcta → permitido", () => {
    expect(shouldBlockDiscoveryTool({ ...base, codegraphOk: true, hasDiscoveryHit: true, areaCovered: true })).toBeNull()
  })
  it("explore de otra área → area_mismatch (D5)", () => {
    expect(shouldBlockDiscoveryTool({ ...base, codegraphOk: true, hasDiscoveryHit: true, areaCovered: false })).toBe("area_mismatch")
  })
})

describe("discovery-order: área del patrón (D5)", () => {
  it("staticDirOf extrae el directorio estático", () => {
    expect(staticDirOf("payments/**/*.ts")).toBe("payments")
    expect(staticDirOf("src/a.ts")).toBe("src")
    expect(staticDirOf("src/")).toBe("src")
    expect(staticDirOf("**/*.ts")).toBe("")
    expect(staticDirOf("*.ts")).toBe("")
    expect(staticDirOf("src")).toBe("")
  })
  it("discoveryCoversArea exige límite de segmento", () => {
    expect(discoveryCoversArea('{"path":"payments/charge.ts"}', "payments")).toBe(true)
    expect(discoveryCoversArea('{"path":"auth/login.ts"}', "payments")).toBe(false)
    expect(discoveryCoversArea('{"path":"mysrc/a.ts"}', "src")).toBe(false)
    expect(discoveryCoversArea('{"path":"/home/x/src/a.ts"}', "src")).toBe(true)
    expect(discoveryCoversArea("", "")).toBe(true)
  })
  it("explore vacío cuenta como discovery para cualquier área (D3)", () => {
    expect(isEmptyExploreResult(null)).toBe(true)
    expect(isEmptyExploreResult("")).toBe(true)
    expect(isEmptyExploreResult([])).toBe(true)
    expect(isEmptyExploreResult({})).toBe(true)
    expect(isEmptyExploreResult({ symbols: [1] })).toBe(false)
  })
})

describe("discovery-order: CodeGraph no indexado y fallos (D6)", () => {
  it("el fixture real de 'no indexado' se detecta como fallo", () => {
    const text = readFileSync(join(import.meta.dir, "fixtures", "codegraph-not-indexed.txt"), "utf-8")
    expect(isNotIndexedOutput(text)).toBe(true)
    expect(isNotIndexedOutput("src/a.ts: createOrder")).toBe(false)
  })
  it("un explore completado (aunque el plugin lo marque 'no indexado' por texto) no es fallo de status", () => {
    expect(marksCodegraphFailure("codegraph_codegraph_explore", "completed")).toBe(false)
  })
  it("strict sigue exigiendo discovery aunque la sesión esté degradada", () => {
    expect(isCodegraphGateActive({ mode: "strict", available: true, degradedSince: Date.now(), now: Date.now(), ttlMs: 60_000 })).toBe(true)
  })
  it("auto degradado dentro del TTL → gate inactivo", () => {
    expect(isCodegraphGateActive({ mode: "auto", available: true, degradedSince: Date.now(), now: Date.now(), ttlMs: 60_000 })).toBe(false)
  })
})

describe("discovery-order: bucle de bloqueos (D7)", () => {
  it("el tercer bloqueo consecutivo es el umbral y se avisa una sola vez", () => {
    let s = 0
    const seen: boolean[] = []
    for (let k = 0; k < 4; k++) {
      const r = discoveryLoopNext(s, true)
      s = r.streak
      seen.push(r.firstAtThreshold)
    }
    expect(DISCOVERY_LOOP_THRESHOLD).toBe(3)
    expect(seen).toEqual([false, false, true, false])
  })
  it("un allow reinicia el contador", () => {
    expect(discoveryLoopNext(2, false)).toEqual({ streak: 0, atThreshold: false, firstAtThreshold: false })
  })
})

describe("discovery-order: Engram (capa 3 de D4)", () => {
  const ttl = engramDegradedTtlMs({})
  it("TTL por defecto 10 min, configurable", () => {
    expect(ttl).toBe(10 * 60_000)
    expect(engramDegradedTtlMs({ OSTACKY_ENGRAM_DEGRADED_TTL_MIN: "2" })).toBe(120_000)
    expect(engramDegradedTtlMs({ OSTACKY_ENGRAM_DEGRADED_TTL_MIN: "x" })).toBe(ttl)
  })
  it("edición de nivel 0 o 0+1 nunca se bloquea", () => {
    expect(shouldBlockEngramEdit({ level: "0", searchedInRequest: false, downSince: null, now: 0, ttlMs: ttl })).toBe(false)
    expect(shouldBlockEngramEdit({ level: "0+1", searchedInRequest: false, downSince: null, now: 0, ttlMs: ttl })).toBe(false)
  })
  it("1+ sin mem_search con Engram respondiendo → bloquea", () => {
    expect(shouldBlockEngramEdit({ level: "1+", searchedInRequest: false, downSince: null, now: 0, ttlMs: ttl })).toBe(true)
  })
  it("1+ con mem_search exitoso → permitido", () => {
    expect(shouldBlockEngramEdit({ level: "1+", searchedInRequest: true, downSince: null, now: 0, ttlMs: ttl })).toBe(false)
  })
  it("1+ con Engram caído dentro del TTL → no bloquea nada", () => {
    expect(shouldBlockEngramEdit({ level: "1+", searchedInRequest: false, downSince: 1000, now: 2000, ttlMs: ttl })).toBe(false)
    expect(engramDegraded({ downSince: 1000, now: 2000, ttlMs: ttl })).toBe(true)
  })
  it("Engram que vuelve (TTL vencido) exige mem_search otra vez", () => {
    expect(shouldBlockEngramEdit({ level: "1+", searchedInRequest: false, downSince: 0, now: ttl + 1, ttlMs: ttl })).toBe(true)
  })
  it("error y timeout marcan Engram caído; completed no", () => {
    expect(marksEngramFailure("error")).toBe(true)
    expect(marksEngramFailure("timeout")).toBe(true)
    expect(marksEngramFailure("completed")).toBe(false)
  })
})

describe("discovery-order: find/fd por shell (D9)", () => {
  it("find sobre src es lectura de código", () => {
    expect(shellReadTargets('find src -name "*.ts"')).toContain("src")
  })
  it("find con patrón de nombre de código es lectura de código aunque la raíz sea '.'", () => {
    expect(shellReadTargets('find . -name "*.ts"')).toContain("*.ts")
  })
  it("fd sobre src es lectura de código", () => {
    expect(shellReadTargets("fd -e ts . src")).toContain("src")
  })
  it("find sobre docs no se gatea", () => {
    expect(shellReadTargets('find docs -name "*.md"')).toEqual([])
  })
  it("rg y grep -r sobre src siguen cubiertos", () => {
    expect(shellReadTargets('rg "createOrder" src/')).toContain("src/")
    expect(shellReadTargets('grep -r "createOrder" src/')).toContain("src/")
  })
})

describe("discovery-order: lectura (sin cambios)", () => {
  it("read de código sin discovery se bloquea", () => {
    expect(shouldBlockCodeRead({ ...base, codegraphOk: true, hasDiscoveryHit: false })).toBe(true)
  })
  it("isCodeReadGated exime literales y docs", () => {
    expect(isCodeReadGated({ ...base, isLiteralGrep: true })).toBe(false)
  })
})
