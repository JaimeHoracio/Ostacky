import { describe, it, expect } from "bun:test";
import { stripJsoncComments } from "./config.js";

describe("stripJsoncComments", () => {
  it("passes through plain JSON unchanged", () => {
    const input = `{"a": 1, "b": "hello"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("strips single-line comments", () => {
    const input = `{\n  // this is a comment\n  "a": 1\n}`;
    const expected = `{\n  \n  "a": 1\n}`;
    expect(stripJsoncComments(input)).toBe(expected);
  });

  it("strips multi-line comments", () => {
    const input = `{\n  /* block\n  comment */\n  "a": 1\n}`;
    const result = stripJsoncComments(input);
    expect(result).not.toContain("/*");
    expect(result).not.toContain("*/");
    expect(result).toContain('"a": 1');
  });

  it("preserves strings containing //", () => {
    const input = `{"url": "http://example.com"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("preserves strings containing /*", () => {
    const input = `{"regex": "/* comment */"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("handles escaped quotes inside strings", () => {
    const input = `{"msg": "hello \\"world\\""}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("strips trailing commas before }", () => {
    const input = `{"a": 1, "b": 2,}`;
    expect(stripJsoncComments(input)).toBe(`{"a": 1, "b": 2}`);
  });

  it("strips trailing commas before ]", () => {
    const input = `[1, 2, 3,]`;
    expect(stripJsoncComments(input)).toBe(`[1, 2, 3]`);
  });

  it("handles empty object", () => {
    expect(stripJsoncComments("{}")).toBe("{}");
  });

  it("handles empty array", () => {
    expect(stripJsoncComments("[]")).toBe("[]");
  });

  it("strips comments after valid JSON", () => {
    const input = `{"a": 1} // trailing comment`;
    const result = stripJsoncComments(input);
    expect(result).toBe(`{"a": 1} `);
  });

  it("works with real-world opencode.jsonc", () => {
    const input = `{
  "$schema": "https://opencode.ai/config.json",
  // MCP servers
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": [".opencode/tools/codegraph/bin/codegraph", "serve", "--mcp"],
      "enabled": true
    }
  }
}`;
    const result = stripJsoncComments(input);
    // Should parse as valid JSON after stripping
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.mcp.codegraph.type).toBe("local");
  });
});
