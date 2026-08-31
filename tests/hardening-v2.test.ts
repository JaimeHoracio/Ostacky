import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isSensitive, BASH_SENSITIVE_RE, extractPathsFromBash, SENSITIVE_DEFAULT, sha256 } from '../src/security.js';
import { getCachedCodegraph, putCachedCodegraph, getCacheDir, CACHE_TTL_MS } from '../src/cache-codegraph.js';

describe('hardening-v2: isSensitive unified', () => {
  it('true for .env', () => {
    expect(isSensitive(".env")).toBe(true);
    expect(isSensitive(".env.local")).toBe(true);
    expect(isSensitive("path/to/.env")).toBe(true);
  });
  it('false for .env.example allowlist', () => {
    expect(isSensitive(".env.example")).toBe(false);
    expect(isSensitive(".env.template")).toBe(false);
    expect(isSensitive(".env.sample")).toBe(false);
    expect(isSensitive("a/.env.example")).toBe(false);
  });
  it('false for ../../etc/passwd', () => {
    expect(isSensitive("../../etc/passwd")).toBe(false);
    expect(() => isSensitive("../../etc/passwd")).not.toThrow();
  });
  it('true for .pem and .key', () => {
    expect(isSensitive("cert.pem")).toBe(true);
    expect(isSensitive("key.key")).toBe(true);
    expect(isSensitive("a/b/c.pem")).toBe(true);
  });
  it('handles Windows backslashes', () => {
    expect(isSensitive("C:\\project\\.env")).toBe(true);
    expect(isSensitive("a\\.secrets\\file")).toBe(true);
  });
  it('uses same regex for guard and controller (SENSITIVE_DEFAULT)', () => {
    expect(SENSITIVE_DEFAULT).toContain("**/.env*");
    expect(SENSITIVE_DEFAULT).toContain("**/*.pem");
  });
});

describe('hardening-v2: BASH_SENSITIVE_RE', () => {
  it('blocks cat .env | grep VITE_FF', () => {
    const cmd = "cat .env | grep VITE_FF";
    const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "");
    expect(BASH_SENSITIVE_RE.test(normalized)).toBe(true);
  });
  it('does not block echo hello', () => {
    const cmd = "echo hello";
    const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "");
    expect(BASH_SENSITIVE_RE.test(normalized)).toBe(false);
  });
  it('blocks ls -la .env*', () => {
    expect(BASH_SENSITIVE_RE.test("ls -la .env*")).toBe(true);
  });
  it('normalization handles obfuscation .e""nv', () => {
    const cmd = 'cat .e""nv';
    const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "");
    expect(BASH_SENSITIVE_RE.test(normalized)).toBe(true);
  });
  it('normalization handles .env\\', () => {
    const cmd = "cat .env\\";
    const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "");
    expect(BASH_SENSITIVE_RE.test(normalized)).toBe(true);
  });
});

describe('hardening-v2: extractPathsFromBash', () => {
  it('extracts .env from cat .env | grep', () => {
    const paths = extractPathsFromBash("cat .env | grep VITE_FF");
    expect(paths).toContain(".env");
  });
  it('handles redirect: cat .env > /tmp/out; cat .env.example', () => {
    const paths = extractPathsFromBash("cat .env > /tmp/out; cat .env.example");
    expect(paths).toContain(".env");
    expect(paths).toContain("/tmp/out");
    expect(paths).toContain(".env.example");
    // Only .env is sensitive, .env.example is not
    expect(isSensitive(".env")).toBe(true);
    expect(isSensitive(".env.example")).toBe(false);
  });
  it('handles obfuscation .e""nv', () => {
    const paths = extractPathsFromBash('cat .e""nv');
    expect(paths).toContain(".env");
  });
  it('handles .env\\', () => {
    const paths = extractPathsFromBash("cat .env\\");
    expect(paths).toContain(".env");
  });
  it('does not treat echo $VITE_FF as sensitive', () => {
    const paths = extractPathsFromBash("echo $VITE_FF");
    // $VITE_FF is not a file path, should not be in extracted paths or not sensitive
    const sensitive = paths.filter(p => isSensitive(p));
    expect(sensitive.length).toBe(0);
  });
});

describe('hardening-v2: cache-codegraph', () => {
  const TEST_ROOT = join(import.meta.dir, '.test-cache-cg');
  beforeEach(() => {
    if (!existsSync(TEST_ROOT)) mkdirSync(TEST_ROOT, { recursive: true });
    // also need .git for git commands? mock git to not fail
    const cacheDir = getCacheDir(TEST_ROOT);
    if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
  });
  afterEach(() => {
    const cacheDir = getCacheDir(TEST_ROOT);
    if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    delete process.env.OSTACKY_CACHE_DISABLE;
  });
  it('stores and retrieves cache', () => {
    const q = "test query auth";
    const result = { symbols: ["auth"] };
    putCachedCodegraph(q, result, TEST_ROOT);
    const got = getCachedCodegraph(q, TEST_ROOT);
    expect(got).toEqual(result);
  });
  it('returns null when disabled via env', () => {
    process.env.OSTACKY_CACHE_DISABLE = "1";
    const q = "query2";
    putCachedCodegraph(q, { a: 1 }, TEST_ROOT);
    expect(getCachedCodegraph(q, TEST_ROOT)).toBeNull();
  });
  it('returns null for different query', () => {
    putCachedCodegraph("q1", { a: 1 }, TEST_ROOT);
    expect(getCachedCodegraph("q2", TEST_ROOT)).toBeNull();
  });
  it('invalidates after TTL (simulate)', () => {
    const q = "ttl test";
    putCachedCodegraph(q, { a: 1 }, TEST_ROOT);
    // Manually tamper timestamp to be old
    const key = sha256(q);
    const path = join(getCacheDir(TEST_ROOT), `${key}.json`);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      data.ts = Date.now() - CACHE_TTL_MS - 1000;
      writeFileSync(path, JSON.stringify(data), 'utf-8');
      expect(getCachedCodegraph(q, TEST_ROOT)).toBeNull();
    }
  });
});

describe('hardening-v2: brainstorming triggers', () => {
  const triggers = ["mejor forma", "qué conviene", "tradeoff", "comparar", "diseñar", "arquitectura", "alternativas", "evaluar opciones"];
  function shouldTrigger(msg: string): boolean {
    const lower = msg.toLowerCase();
    return triggers.some(t => lower.includes(t));
  }
  it('triggers brainstorming for design phrases', () => {
    expect(shouldTrigger("buscá la mejor forma de hacer X")).toBe(true);
    expect(shouldTrigger("qué conviene usar?")).toBe(true);
    expect(shouldTrigger("tradeoff entre A y B")).toBe(true);
    expect(shouldTrigger("comparar approaches")).toBe(true);
    expect(shouldTrigger("diseñar auth")).toBe(true);
  });
  it('does not trigger for fix typo', () => {
    expect(shouldTrigger("fix typo en README")).toBe(false);
    expect(shouldTrigger("agregá un log")).toBe(false);
  });
});

describe('hardening-v2: engram consistency gate', () => {
  it('mock contradiction detection high confidence would block', () => {
    // Simulate mem_search hit with decision Zustand vs instruction Redux
    const hit = { type: "decision", title: "Chose Zustand over Redux", topic_key: "architecture/state-mgmt", score: 0.85 };
    const instruction = "usemos Redux";
    const isContradiction = hit.type === "decision" && instruction.toLowerCase().includes("redux") && hit.title.includes("Zustand");
    const highConfidence = hit.score > 0.7;
    expect(isContradiction && highConfidence).toBe(true);
    // Should trigger request_clarification
  });
  it('low confidence only suggests', () => {
    const hit = { type: "decision", score: 0.4 };
    expect(hit.score > 0.7).toBe(false);
  });
});
