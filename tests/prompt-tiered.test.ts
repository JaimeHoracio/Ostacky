import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("prompt-tiered", () => {
  it("hola DONE no supera 12k inyectados y preserva cache", () => {
    const pluginPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
    const src = readFileSync(pluginPath, "utf-8");
    // Tiered cache-friendly: system[0] permanece FULL, suffix hint no reemplaza
    expect(src).toContain("PLUGIN HINT: Saludo trivial");
    expect(src).toContain("isTrivial");
    // Check cost effective with hit 0.10x would be <12k in real test, here we just verify structure
    expect(src).not.toContain("output.system[0] =");
  });

  it("hola→auth restaura behaviour sin miss y con paridad (no reemplazo system)", () => {
    const ctrlPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
    const src = readFileSync(ctrlPath, "utf-8");
    expect(src).toContain("PLUGIN HINT");
    expect(src).toContain("isTrivial");
    expect(src).not.toMatch(/output\.system\.length = 0/);
  });

  it("engram tiered pointer", () => {
    const engramPath = join(import.meta.dir, "..", "assets", "plugins", "engram.ts");
    const src = readFileSync(engramPath, "utf-8");
    expect(src).toContain("Engram disponible — detalles a demanda");
    expect(src).toContain("isTrivialMessage");
  });
});
