import { createHash } from "crypto";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { getCached, putCache, getCacheRoot } from "./cache.js";

const TEST_REPO = "test/repo";
const TEST_TAG = "v1.0.0";
const TEST_FILE = "test-file.txt";
const TEST_CONTENT = "hello cache";

// Use a temporary project root for testing
const TEST_PROJECT_ROOT = join(import.meta.dir, ".test-cache-project");

describe("cache module", () => {
  beforeEach(() => {
    // Create test project directory
    if (!existsSync(TEST_PROJECT_ROOT)) {
      mkdirSync(TEST_PROJECT_ROOT, { recursive: true });
    }
    // Clean up before each test
    const cacheDir = getCacheRoot(TEST_PROJECT_ROOT);
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    const cacheDir = getCacheRoot(TEST_PROJECT_ROOT);
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
    // Remove test project directory
    if (existsSync(TEST_PROJECT_ROOT)) {
      rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    }
  });

  it("stores and retrieves cached content", () => {
    putCache(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, TEST_CONTENT);
    const result = getCached(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE);
    expect(result).toBe(TEST_CONTENT);
  });

  it("returns null when no cache exists", () => {
    const result = getCached(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, "nonexistent.txt");
    expect(result).toBeNull();
  });

  it("validates content against expected hash", () => {
    putCache(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, TEST_CONTENT);
    const expectedHash = createHash("sha256").update(TEST_CONTENT, "utf-8").digest("hex");
    const result = getCached(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, expectedHash);
    expect(result).toBe(TEST_CONTENT);
  });

  it("returns null when hash does not match", () => {
    putCache(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, TEST_CONTENT);
    const result = getCached(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, "badhash");
    expect(result).toBeNull();
  });

  it("overwrites existing cache with new content", () => {
    putCache(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, "old content");
    putCache(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE, TEST_CONTENT);
    const result = getCached(TEST_PROJECT_ROOT, TEST_REPO, TEST_TAG, TEST_FILE);
    expect(result).toBe(TEST_CONTENT);
  });
});
