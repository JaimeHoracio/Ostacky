import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./security.js";
import { getCacheDir, CACHE_TTL_MS, CACHE_MAX_BYTES, getGitDiffHash, getGitHead, getCacheKey } from "./cache-codegraph.js";

export const DISCOVERY_CACHE_PREFIX = "discovery-";

/**
 * Discovery snapshot cached per query + gitDiffHash.
 * Single source of truth for codegraph_explore + engram_mem_search reuse.
 */
export interface DiscoverySnapshot {
  codegraph: any | null;
  engramHits: any[] | null;
  gitDiffHash: string | null;
  gitHead: string | null;
  ts: number;
  query: string;
}

function getDiscoveryPath(query: string, projectRoot: string): string {
  const dir = getCacheDir(projectRoot);
  const key = DISCOVERY_CACHE_PREFIX + getCacheKey(query);
  return join(dir, `${key}.json`);
}

/**
 * Returns cached discovery snapshot if valid, else null.
 * Valid if exists, not expired (TTL 1h), and gitDiffHash matches current.
 * Migrates legacy codegraph/<hash>.json → discovery-<hash>.json on miss.
 * On hit increments cacheHitCount/discoveryCacheHitCount/tokenSavingEstimate via internal write coalescido.
 */
export function getDiscoverySnapshot(query: string, projectRoot: string): DiscoverySnapshot | null {
  if (process.env.OSTACKY_CACHE_DISABLE === "1") return null;
  const path = getDiscoveryPath(query, projectRoot);
  if (!existsSync(path)) {
    // migrate legacy codegraph cache if exists
    try {
      const legacyPath = join(getCacheDir(projectRoot), `${getCacheKey(query)}.json`);
      if (existsSync(legacyPath)) {
        const rawLegacy = readFileSync(legacyPath, "utf-8");
        const legacy = JSON.parse(rawLegacy);
        if (legacy?.result && typeof legacy.ts === "number") {
          const migrated: DiscoverySnapshot = {
            query,
            codegraph: legacy.result,
            engramHits: null,
            gitDiffHash: legacy.gitDiffHash ?? getGitDiffHash(projectRoot),
            gitHead: legacy.gitHead ?? getGitHead(projectRoot),
            ts: legacy.ts,
          };
          // validate TTL and gitDiffHash still valid before migrating
          if (Date.now() - migrated.ts <= CACHE_TTL_MS) {
            const currentDiff = getGitDiffHash(projectRoot);
            if (migrated.gitDiffHash === undefined || migrated.gitDiffHash === currentDiff) {
              const dir = getCacheDir(projectRoot);
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
              writeFileSync(path, JSON.stringify(migrated), "utf-8");
              incrementDiscoveryHit(projectRoot);
              return migrated;
            }
          }
        }
      }
    } catch {}
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as DiscoverySnapshot & { ts: number };
    if (typeof data.ts !== "number") return null;
    if (Date.now() - data.ts > CACHE_TTL_MS) return null;
    const currentDiff = getGitDiffHash(projectRoot);
    if (data.gitDiffHash !== undefined && data.gitDiffHash !== currentDiff) return null;
    try { incrementDiscoveryHit(projectRoot); } catch {}
    return data;
  } catch {
    return null;
  }
}

function incrementDiscoveryHit(projectRoot: string): void {
  try {
    const statePath = join(projectRoot, ".opencode", "ostacky-state.json");
    if (!existsSync(statePath)) return;
    const raw = readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw);
    state.cacheHitCount = (state.cacheHitCount || 0) + 1;
    state.discoveryCacheHitCount = (state.discoveryCacheHitCount || 0) + 1;
    state.tokenSavingEstimate = (state.tokenSavingEstimate || 0) + 500;
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

export function putDiscoverySnapshot(
  query: string,
  payload: { codegraph: any; engramHits?: any[] },
  projectRoot: string
): void {
  if (process.env.OSTACKY_CACHE_DISABLE === "1") return;
  const dir = getCacheDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    enforceCacheLimit(dir);
  } catch {}
  const path = getDiscoveryPath(query, projectRoot);
  const data: DiscoverySnapshot = {
    query,
    codegraph: payload.codegraph ?? null,
    engramHits: payload.engramHits ?? null,
    gitDiffHash: getGitDiffHash(projectRoot),
    gitHead: getGitHead(projectRoot),
    ts: Date.now(),
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

/**
 * In-memory dedup for engram_mem_search per requestId.
 * Map query -> result, cleared per request.
 */
const engramDedupByRequest = new Map<string, Map<string, any>>();

export function getEngramDedup(query: string, requestId: string): any | null {
  const byReq = engramDedupByRequest.get(requestId);
  if (!byReq) return null;
  return byReq.get(query) ?? null;
}

export function putEngramDedup(query: string, requestId: string, result: any): void {
  let byReq = engramDedupByRequest.get(requestId);
  if (!byReq) {
    byReq = new Map();
    engramDedupByRequest.set(requestId, byReq);
  }
  byReq.set(query, result);
}

export function clearEngramDedup(requestId: string): void {
  engramDedupByRequest.delete(requestId);
}

export function clearDiscoveryCache(projectRoot: string): void {
  const dir = getCacheDir(projectRoot);
  if (!existsSync(dir)) return;
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(DISCOVERY_CACHE_PREFIX)) {
        try {
          unlinkSync(join(dir, f));
        } catch {}
      }
    }
  } catch {}
}

export function getDiscoveryCacheStats(projectRoot: string): { count: number; totalBytes: number } {
  const dir = getCacheDir(projectRoot);
  if (!existsSync(dir)) return { count: 0, totalBytes: 0 };
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith(DISCOVERY_CACHE_PREFIX));
    let total = 0;
    for (const f of files) {
      try {
        total += statSync(join(dir, f)).size;
      } catch {}
    }
    return { count: files.length, totalBytes: total };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
