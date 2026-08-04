import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTreeHash } from "../src/fs.js";
import { sha256 } from "../src/security.js";

const projectRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf-8")) as {
  agents: Array<{ name: string; sha256: string }>;
  mcpServers: Array<{ name: string; sha256: string }>;
};

describe("manifest asset hashes", () => {
  it("only declares MCP servers that are bundled in assets", () => {
    for (const server of manifest.mcpServers) {
      expect(existsSync(join(projectRoot, "assets", "mcp", server.name))).toBe(true);
    }
  });

  it("matches the bundled Ostacky agent source", () => {
    const agent = manifest.agents.find((item) => item.name === "ostacky");
    expect(agent?.sha256).toBe(
      sha256(readFileSync(join(projectRoot, "assets", "agents", "ostacky.md"), "utf-8"))
    );
  });

  it("matches the bundled controller source tree", () => {
    const controller = manifest.mcpServers.find((item) => item.name === "ostacky-controller");
    expect(controller?.sha256).toBe(
      computeTreeHash(join(projectRoot, "assets", "mcp", "ostacky-controller"))
    );
  });
});
