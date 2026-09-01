import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const pluginPath = join(import.meta.dir, "..", "assets","plugins","ostacky-plugin.ts");
const pluginSrc = existsSync(pluginPath) ? readFileSync(pluginPath, "utf-8") : "";

describe("controller-hybrid", () => {
  it("plugin exists and has no LEVEL_RESOLVED", () => {
    expect(existsSync(pluginPath)).toBe(true);
    expect(pluginSrc.includes("LEVEL_RESOLVED")).toBe(false);
  });

  it("PENDING bloquea read (hard gate)", () => {
    expect(pluginSrc).toContain("ROUTE_DECISION_PENDING");
    expect(pluginSrc).toContain("BLOCKED: call consume_* first");
    expect(pluginSrc).toContain("tool.execute.before");
  });

  it("PENDING permite consume_route_decision", () => {
    expect(pluginSrc).toContain("consume_route_decision");
    expect(pluginSrc).toContain("consume_execution_decision");
    expect(pluginSrc).toContain("record_clarification");
  });

  it("validate_edit in-process", () => {
    expect(pluginSrc).toContain("validate_edit");
    expect(pluginSrc).toContain("oldString === newString");
    expect(pluginSrc).toContain("CONFLICT: stale fingerprint");
  });

  it("tool observables exist", () => {
    expect(pluginSrc).toContain("ostacky_get_state");
    expect(pluginSrc).toContain("ostacky_get_audit");
    expect(pluginSrc).toContain("ostacky_get_metrics");
    expect(pluginSrc).toContain("ostacky_get_handoff");
  });

  it("cache único hit increments", () => {
    const dcPath = join(import.meta.dir, "..", "src", "discovery-cache.ts");
    const dcSrc = readFileSync(dcPath, "utf-8");
    expect(dcSrc).toContain("getDiscoverySnapshot");
    expect(dcSrc).toContain("DISCOVERY_CACHE_PREFIX");
    expect(dcSrc).toContain("incrementDiscoveryHit");
  });

  it("router determinista 1+ estLines 10 fileCount1 downgrade", () => {
    const mcpPath = join(import.meta.dir, "..", "assets", "mcp", "ostacky-controller", "index.js");
    const mcpSrc = readFileSync(mcpPath, "utf-8");
    expect(mcpSrc).toContain("router_downgrade_to_direct");
    expect(mcpSrc).toContain("estLinesVal > 30");
  });

  it("hola DONE trivial hint + SKIP", () => {
    expect(pluginSrc).toContain("isTrivial");
    expect(pluginSrc).toContain("SKIP: trivial greeting");
    expect(pluginSrc).toContain("PLUGIN HINT: Saludo trivial");
  });
});
