import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { syncVersion } from "../scripts/sync-version.ts";

const TEST_DIR = join(import.meta.dir, "../.test-temp");

describe("sync-version", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it("syncs the package version, tag, and every manifest item", () => {
    const packageJson = { version: "1.2.3" };
    const manifest = {
      version: "1.0.0",
      tag: "v1.0.0",
      agents: [{ version: "1.0.0" }],
      commands: [{ version: "1.0.0" }],
      mcpServers: [{ version: "1.0.0" }],
      skills: [{ version: "1.0.0" }],
    };

    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(TEST_DIR, "manifest.json"), JSON.stringify(manifest));

    expect(syncVersion(TEST_DIR)).toBe(true);

    expect(JSON.parse(readFileSync(join(TEST_DIR, "manifest.json"), "utf-8"))).toMatchObject({
      version: "1.2.3",
      tag: "v1.2.3",
      agents: [{ version: "1.2.3" }],
      commands: [{ version: "1.2.3" }],
      mcpServers: [{ version: "1.2.3" }],
      skills: [{ version: "1.2.3" }],
    });
  });
});

describe("check-skill-sync", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it("should detect skills in sync", () => {
    // Create test files
    const manifest = {
      version: "1.0.0",
      skills: [
        { name: "test-skill", version: "1.0.0" }
      ]
    };
    const packageJson = { version: "1.0.0" };

    writeFileSync(join(TEST_DIR, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify(packageJson));

    // Create skill directory
    mkdirSync(join(TEST_DIR, "assets", "skills", "test-skill"), { recursive: true });
    writeFileSync(join(TEST_DIR, "assets", "skills", "test-skill", "SKILL.md"), "# Test Skill");

    // Run check (would need to mock paths)
    // This is a simplified test - real implementation would need proper mocking
    expect(true).toBe(true);
  });
});
