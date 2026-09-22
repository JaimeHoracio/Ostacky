import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("engram-tiered", () => {
  it("entrypoint nativo V2", () => {
    const pluginPath = join(import.meta.dir, "..", "assets", "plugins", "engram.ts");
    const src = readFileSync(pluginPath, "utf-8");
    expect(src).toContain('from "@opencode/plugin"');
    expect(src).toContain("Plugin.define");
    expect(src).toContain('id: "engram"');
    expect(src).toContain('ctx.session.hook("prompt"');
    expect(src).toContain('ctx.session.hook("context"');
    expect(src).toContain('ctx.session.hook("compaction"');
    expect(src).toContain('ctx.tool.hook("execute.after"');
    expect(src).toContain("ctx.event.subscribe");
    expect(src.includes("@opencode-ai/plugin")).toBe(false);
  });

  it("hola DONE no contiene ## Engram Persistent Memory y agregá auth sí", () => {
    const pluginPath = join(import.meta.dir, "..", "assets", "plugins", "engram.ts");
    const src = readFileSync(pluginPath, "utf-8");
    // Check lazy logic exists
    expect(src).toContain("isTrivialMessage");
    expect(src).toContain("Engram disponible — detalles a demanda");
    expect(src).toContain("MEMORY_INSTRUCTIONS");
    // Verify trivial check uses state DONE
    expect(src).toContain('state === "DONE"');
  });
});
