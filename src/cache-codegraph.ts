import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sha256 } from "./security.js";

export const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
export const CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const CACHE_DIR_NAME = "codegraph";

export function getCacheDir(projectRoot: string): string {
  return join(projectRoot, ".opencode", "cache", CACHE_DIR_NAME);
}

export function getCacheKey(query: string): string {
  return sha256(query);
}

export function getGitHead(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function getGitDiffHash(projectRoot: string): string | null {
  try {
    const diff = execSync("git diff --name-only", { cwd: projectRoot, encoding: "utf-8" }).trim();
    return diff ? sha256(diff) : "";
  } catch {
    return null;
  }
}

/**
 * Returns cached CodeGraph result if valid, else null.
 * Valid if: exists, not expired (TTL 1h), git diff hash matches, and OSTACKY_CACHE_DISABLE !== "1".
 */
export function getCachedCodegraph(query: string, projectRoot: string): any | null {
  if (process.env.OSTACKY_CACHE_DISABLE === "1") return null;
  const dir = getCacheDir(projectRoot);
  const key = getCacheKey(query);
  const path = join(dir, `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.ts !== "number") return null;
    if (Date.now() - data.ts > CACHE_TTL_MS) return null;
    const currentDiff = getGitDiffHash(projectRoot);
    if (data.gitDiffHash !== undefined && data.gitDiffHash !== currentDiff) return null;
    // Also check HEAD change: if HEAD changed and cache is old, invalidate
    // (we keep simple: diff hash already captures changes, HEAD change without diff still valid)
    return data.result ?? null;
  } catch {
    return null;
  }
}

export function putCachedCodegraph(query: string, result: any, projectRoot: string): void {
  if (process.env.OSTACKY_CACHE_DISABLE === "1") return;
  const dir = getCacheDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    enforceCacheLimit(dir);
  } catch {}
  const key = getCacheKey(query);
  const path = join(dir, `${key}.json`);
  const data = {
    ts: Date.now(),
    result,
    gitHead: getGitHead(projectRoot),
    gitDiffHash: getGitDiffHash(projectRoot),
  };
  writeFileSync(path, JSON.stringify(data), "utf-8");
}

function enforceCacheLimit(dir: string): void {
  try {
    const files = readdirSync(dir);
    let total = 0;
    const entries: { file: string; size: number; mtime: number }[] = [];
    for (const f of files) {
      const fp = join(dir, f);
      try {
        const s = statSync(fp);
        total += s.size;
        entries.push({ file: fp, size: s.size, mtime: s.mtimeMs });
      } catch {}
    }
    if (total <= CACHE_MAX_BYTES) return;
    // LRU: sort by mtime oldest first
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      try {
        unlinkSync(e.file);
        total -= e.size;
        if (total <= CACHE_MAX_BYTES) break;
      } catch {}
    }
  } catch {}
}

export function getCacheStats(projectRoot: string): { count: number; totalBytes: number } {
  const dir = getCacheDir(projectRoot);
  if (!existsSync(dir)) return { count: 0, totalBytes: 0 };
  try {
    const files = readdirSync(dir);
    let total = 0;
    for (const f of files) {
      try { total += statSync(join(dir, f)).size; } catch {}
    }
    return { count: files.length, totalBytes: total };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
