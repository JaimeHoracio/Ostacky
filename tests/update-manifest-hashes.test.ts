import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { updateManifestHashes } from "../scripts/update-manifest-hashes.ts";

const TEST_ROOT = join(import.meta.dir, ".test-manifest-hashes");

afterEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("updateManifestHashes", () => {
  it("updates file and directory hashes and rejects stale hashes in check mode", () => {
    mkdirSync(join(TEST_ROOT, "assets", "mcp", "server"), { recursive: true });
    writeFileSync(join(TEST_ROOT, "assets", "agent.md"), "agent", "utf-8");
    writeFileSync(join(TEST_ROOT, "assets", "mcp", "server", "index.js"), "server", "utf-8");
    writeFileSync(join(TEST_ROOT, "manifest.json"), JSON.stringify({
      agents: [{ name: "agent", file: "assets/agent.md", sha256: "stale" }],
      commands: [],
      skills: [],
      mcpServers: [{ name: "server", file: "assets/mcp/server/", sha256: "stale" }],
    }), "utf-8");

    expect(() => updateManifestHashes(TEST_ROOT, true)).toThrow("Hash desactualizado");
    expect(updateManifestHashes(TEST_ROOT)).toBe(true);
    expect(() => updateManifestHashes(TEST_ROOT, true)).not.toThrow();

    const manifest = JSON.parse(readFileSync(join(TEST_ROOT, "manifest.json"), "utf-8"));
    expect(manifest.agents[0].sha256).not.toBe("stale");
    expect(manifest.mcpServers[0].sha256).not.toBe("stale");
  });
});
