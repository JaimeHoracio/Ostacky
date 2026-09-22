import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mcpPath = join(import.meta.dir, "..", "assets", "mcp", "ostacky-controller", "index.js");
const src = readFileSync(mcpPath, "utf-8");

describe("mcp-surface", () => {
  it("no expone tools de cache muertas", () => {
    expect(src.includes("'record_cache_hit'")).toBe(false);
    expect(src.includes("'record_cache_miss'")).toBe(false);
    expect(src.includes("recordCacheHit")).toBe(false);
    expect(src.includes("recordCacheMiss")).toBe(false);
  });

  it("conserva las tools vivas clave", () => {
    for (const name of ["'ping'", "'start_request'", "'get_state'", "'record_discovery'", "'consume_route_decision'", "'complete_task'"]) {
      expect(src.includes(name)).toBe(true);
    }
  });
});
