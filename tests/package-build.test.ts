import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")
) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

describe("package build configuration", () => {
  it("bundles the CLI for published installations", () => {
    expect(packageJson.scripts.build).toContain("build:cli");
    expect(packageJson.scripts["build:cli"]).toContain("src/cli.ts");
    expect(packageJson.scripts["build:cli"]).toContain("dist/cli.js");
  });

  it("bundles MCP servers for published installations", () => {
    expect(packageJson.scripts.build).toContain("build:mcp");
    expect(packageJson.scripts["build:mcp"]).toContain("build-mcp-bundles");
  });

  it("declares the dependencies required for build", () => {
    expect(packageJson.devDependencies["@types/bun"]).toBeDefined();
    expect(packageJson.devDependencies["typescript"]).toBeDefined();
  });

  it("checks that prepublish runs build", () => {
    expect(packageJson.scripts.prepublishOnly).toContain("build");
  });
});
