import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sha256 } from "./security.js";

// INTERNAL — único entrypoint es src/discovery-cache.ts getDiscoverySnapshot/putDiscoverySnapshot.
// Este módulo es helper interno para discovery-cache, no API directa del agente.
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

const gitDiffMemo = new Map<string, { hash: string | null; ts: number }>();
const GIT_DIFF_MEMO_TTL = 5000;

export function getGitDiffHash(projectRoot: string): string | null {
  const now = Date.now();
  const memo = gitDiffMemo.get(projectRoot);
  if (memo && now - memo.ts < GIT_DIFF_MEMO_TTL) return memo.hash;
  try {
    const diff = execSync("git diff --name-only", { cwd: projectRoot, encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain --untracked-files=all", { cwd: projectRoot, encoding: "utf-8" }).trim();
    const combined = [diff, status].filter(Boolean).join("\n");
    const hash = combined ? sha256(combined) : "";
    gitDiffMemo.set(projectRoot, { hash, ts: now });
    return hash;
  } catch {
    return null;
  }
}

/**
 * Returns cached CodeGraph result if valid, else null.
 * Valid if: exists, not expired (TTL 1h), git diff hash matches, and OSTACKY_CACHE_DISABLE !== "1".
 * Internal: increments discoveryCacheHitCount/tokenSavingEstimate directly in state file (no MCP tool).
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
    // internal metric bump (no MCP round-trip) — best-effort
    try {
      incrementCacheHit(projectRoot);
    } catch {}
    return data.result ?? null;
  } catch {
    return null;
  }
}

// Batch cache hit increments — flush coalesced after 1s to avoid write per hit
const pendingCacheHits = new Map<string, number>();
const pendingCacheTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushPendingCacheHits(projectRoot: string): void {
  const pending = pendingCacheHits.get(projectRoot);
  if (!pending) return;
  pendingCacheHits.delete(projectRoot);
  const timer = pendingCacheTimers.get(projectRoot);
  if (timer) {
    clearTimeout(timer);
    pendingCacheTimers.delete(projectRoot);
  }
  try {
    const statePath = join(projectRoot, ".opencode", "ostacky-state.json");
    if (!existsSync(statePath)) return;
    const raw = readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw);
    state.cacheHitCount = (state.cacheHitCount || 0) + pending;
    state.discoveryCacheHitCount = (state.discoveryCacheHitCount || 0) + pending;
    state.tokenSavingEstimate = (state.tokenSavingEstimate || 0) + 500 * pending;
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function incrementCacheHit(projectRoot: string): void {
  const prev = pendingCacheHits.get(projectRoot) ?? 0;
  pendingCacheHits.set(projectRoot, prev + 1);
  if (!pendingCacheTimers.has(projectRoot)) {
    const t = setTimeout(() => flushPendingCacheHits(projectRoot), 1000);
    // Don't block process exit
    if (typeof (t as any).unref === "function") (t as any).unref();
    pendingCacheTimers.set(projectRoot, t);
  }
}

export function flushCacheHits(projectRoot: string): void {
  flushPendingCacheHits(projectRoot);
}

export function putCachedCodegraph(query: string, result: any, projectRoot: string): void {
  if (process.env.OSTACKY_CACHE_DISABLE === "1") return;
  // Flush batched hits before put so metrics are coherent
  try { flushPendingCacheHits(projectRoot); } catch {}
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

export function enforceCacheLimit(dir: string): void {
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
