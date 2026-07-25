import { describe, it, expect } from "bun:test";
import { validateFilePath, sha256, verifyChecksum } from "./security.js";

describe("validateFilePath", () => {
  it("accepts simple relative paths", () => {
    expect(() => validateFilePath("foo/bar.md")).not.toThrow();
  });

  it("accepts paths with dots in filenames", () => {
    expect(() => validateFilePath("skills/my.skill/SKILL.md")).not.toThrow();
  });

  it("rejects paths with .. traversal", () => {
    expect(() => validateFilePath("../etc/passwd")).toThrow();
    expect(() => validateFilePath("foo/../../bar")).toThrow();
  });

  it("rejects absolute Unix paths", () => {
    expect(() => validateFilePath("/etc/passwd")).toThrow();
  });

  it("rejects absolute Windows paths", () => {
    expect(() => validateFilePath("C:\\Users\\evil")).toThrow();
    expect(() => validateFilePath("D:/malware.exe")).toThrow();
  });

  it("rejects paths starting with backslash", () => {
    expect(() => validateFilePath("\\evil.exe")).toThrow();
  });
});

describe("sha256", () => {
  it("returns a 64-character hex string", () => {
    const hash = sha256("hello");
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it("is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("handles empty string", () => {
    const hash = sha256("");
    expect(hash).toHaveLength(64);
  });

  it("known test vector", () => {
    // SHA-256 of "abc"
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("verifyChecksum", () => {
  it("passes when hash matches", () => {
    expect(() => verifyChecksum("abc", sha256("abc"), "test")).not.toThrow();
  });

  it("throws when hash does not match", () => {
    expect(() => verifyChecksum("abc", "0000000000000000000000000000000000000000000000000000000000000000", "test")).toThrow();
  });

  it("is a no-op with null expected hash", () => {
    expect(() => verifyChecksum("abc", null, "test")).not.toThrow();
  });

  it("is a no-op with undefined expected hash", () => {
    expect(() => verifyChecksum("abc", undefined, "test")).not.toThrow();
  });
});
