import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")
) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

describe("package build configuration", () => {
  it("bundles the controller MCP for published installations", () => {
    expect(packageJson.scripts.build).toContain("assets/mcp/ostacky-controller/index.js");
    expect(packageJson.scripts.build).toContain("dist/mcp/ostacky-controller/index.js");
  });

  it("declares the dependencies required to bundle the controller", () => {
    expect(packageJson.devDependencies["@modelcontextprotocol/server"]).toBeDefined();
    expect(packageJson.devDependencies.zod).toBeDefined();
  });

  it("checks asset hashes before publishing", () => {
    expect(packageJson.scripts.prepublishOnly).toContain("hash:check");
  });
});
