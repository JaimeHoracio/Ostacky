import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isCodeReadGated,
  marksDiscovery,
  shouldBlockCodeRead,
} from "../assets/plugins/ostacky-controller/index.ts";

const pluginPath = join(import.meta.dir, "..", "assets", "plugins", "ostacky-controller", "index.ts");

/** Caso base: read de un .ts de código, sin exenciones. */
const base = {
  isCodeFile: true,
  isLiteralGrep: false,
  isSpecTasksPath: false,
  isDocsPath: false,
  isTaskTracked: false,
};

// Este test verifica el INVARIANTE del gate, no su mensaje. El anterior hacía
// `expect(src).toContain("Usá getDiscoverySnapshot primero")`: pasaba verde con el gate
// inescapable adentro (fix-codegraph-gate).

describe("codegraph-gate — invariante de bloqueo/desbloqueo", () => {
  it("sin discovery y con CodeGraph disponible → BLOCKED", () => {
    expect(shouldBlockCodeRead({ ...base, codegraphOk: true, hasDiscoveryHit: false })).toBe(true);
  });

  it("con discovery hit → NO bloquea (el camino que faltaba)", () => {
    expect(shouldBlockCodeRead({ ...base, codegraphOk: true, hasDiscoveryHit: true })).toBe(false);
  });

  it("sin CodeGraph disponible → NO bloquea (degradación: se permite Read)", () => {
    expect(shouldBlockCodeRead({ ...base, codegraphOk: false, hasDiscoveryHit: false })).toBe(false);
  });

  it("exenciones: docs, openspec/changes|specs, grep de literales, archivo ya trackeado, no-código", () => {
    const exenciones = [
      { isDocsPath: true },
      { isSpecTasksPath: true },
      { isLiteralGrep: true },
      { isTaskTracked: true },
      { isCodeFile: false },
    ];
    for (const exencion of exenciones) {
      const input = { ...base, ...exencion };
      expect(isCodeReadGated(input)).toBe(false);
      expect(shouldBlockCodeRead({ ...input, codegraphOk: true, hasDiscoveryHit: false })).toBe(false);
    }
  });
});

describe("codegraph-gate — la señal de discovery es una tool que EXISTE", () => {
  it("codegraph_explore marca discovery (la contradicción que arregla fix-codegraph-gate)", () => {
    expect(marksDiscovery("codegraph_codegraph_explore")).toBe(true);
    expect(marksDiscovery("codegraph_explore")).toBe(true);
  });

  it("getDiscoverySnapshot queda aceptado para cuando sea una tool real (change discovery-cache-tool)", () => {
    expect(marksDiscovery("getDiscoverySnapshot")).toBe(true);
  });

  it("tools ajenas NO marcan discovery", () => {
    for (const tool of ["read", "grep", "glob", "shell", "edit", "codegraph_codegraph_status"]) {
      expect(marksDiscovery(tool)).toBe(false);
    }
  });
});

describe("codegraph-gate — cableado", () => {
  const src = readFileSync(pluginPath, "utf-8");

  it("el hook usa el predicado puro (no quedó una copia divergente inline)", () => {
    expect(src).toContain("shouldBlockCodeRead({");
    expect(src).toContain("marksDiscovery(tool)");
  });

  it("el mensaje del gate nombra una tool registrable", () => {
    // El mensaje viejo mandaba a `getDiscoverySnapshot` como ÚNICA salida — tool que nunca existió.
    expect(src).not.toContain("sugerencia: getDiscoverySnapshot");
    // El mensaje nuevo ofrece el camino que sí existe.
    expect(src).toContain('codegraph_codegraph_explore("${targetPath');
  });
});
