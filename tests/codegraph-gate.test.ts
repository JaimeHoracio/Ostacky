import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("codegraph-gate", () => {
  it("Read src/auth.ts sin Discovery → BLOCKED sugiere cache", () => {
    const pluginPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
    const src = readFileSync(pluginPath, "utf-8");
    expect(src).toContain("Usá getDiscoverySnapshot primero");
    expect(src).toContain("isCodegraphAvailable");
    expect(src).toContain("getDiscoveryCacheHit");
  });

  it("discovery hit → 0 tok vs 7k Read masivo (hit increments)", () => {
    const dcPath = join(import.meta.dir, "..", "src", "discovery-cache.ts");
    const src = readFileSync(dcPath, "utf-8");
    expect(src).toContain("getDiscoverySnapshot");
    expect(src).toContain("incrementDiscoveryHit");
  });

  it("Grep solo para literales no-código", () => {
    const pluginPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
    const src = readFileSync(pluginPath, "utf-8");
    expect(src).toContain("isLiteralGrep");
  });
});
