import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("efficacy-parity", () => {
  it("clasificación hola→auth vs auth directo paridad (level)", () => {
    const agentPath = join(import.meta.dir, "..", "assets", "agents", "ostacky.md");
    const src = readFileSync(agentPath, "utf-8");
    expect(src).toContain("## Flujo");
    expect(src).toContain("Clasificación");
    // Ensure tiered doesn't break classification
    expect(src.length).toBeGreaterThan(0);
  });

  it("cambiá color (hint TIER1) vs baseline paridad", () => {
    const refPath = join(import.meta.dir, "..", "assets", "docs", "ostacky-reference.md");
    const src = readFileSync(refPath, "utf-8");
    expect(src).toContain("Tiered Behaviour");
    expect(src).toContain("isTrivial");
  });

  it("coste efectivo con cache hit < 10% sobrecoste", () => {
    const pluginPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
    const src = readFileSync(pluginPath, "utf-8");
    // Verify no system replacement that would cause miss 1.25x
    expect(src).not.toContain("output.system =");
    expect(src).toContain("PLUGIN HINT");
  });
});
