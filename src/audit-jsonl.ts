import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

export function getAuditPath(projectRoot: string): string {
  return join(projectRoot, ".opencode", "ostacky-audit.jsonl");
}

function getRetention(): number {
  const raw = process.env.OSTACKY_AUDIT_RETENTION;
  if (raw == null || raw === "") return 500;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return 500;
  if (n > 2000) return 2000;
  return n;
}

export function appendAudit(projectRoot: string, entry: any): void {
  if (projectRoot === "/tmp" || projectRoot === "/") return;
  const path = getAuditPath(projectRoot);
  try { mkdirSync(dirname(path), { recursive: true }); } catch {}
  try {
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
    // Enforce retention (OSTACKY_AUDIT_RETENTION)
    try {
      const retention = getRetention();
      const raw = readFileSync(path, "utf-8");
      const entries = raw.split("\n").filter(Boolean);
      if (entries.length > retention) {
        const keep = entries.slice(-retention);
        writeFileSync(path, keep.join("\n") + "\n", "utf-8");
      }
    } catch {}
    rotateIfNeeded(projectRoot);
  } catch {}
}

export function readAudit(projectRoot: string, opts: { phase?: string; since?: number; limit?: number; offset?: number } = {}): any[] {
  const path = getAuditPath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    let entries = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
    if (opts.phase) entries = entries.filter(e => e.phase === opts.phase);
    if (opts.since) entries = entries.filter(e => e.ts >= opts.since!);
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const start = Math.max(0, entries.length - limit - offset);
    const end = entries.length - offset;
    return entries.slice(start, end).reverse();
  } catch { return []; }
}

function rotateIfNeeded(projectRoot: string): void {
  const path = getAuditPath(projectRoot);
  try {
    const stat = statSync(path);
    if (stat.size < 500 * 1024) return;
    const entries = readAudit(projectRoot, { limit: 1000 });
    const keep = entries.slice(0, 500).reverse();
    writeFileSync(path, keep.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  } catch {}
}

export function migrateAuditFromState(projectRoot: string, state: any): boolean {
  if (!state.audit || !Array.isArray(state.audit) || state.audit.length === 0) return false;
  const path = getAuditPath(projectRoot);
  if (existsSync(path)) return false;
  try {
    for (const e of state.audit) appendAudit(projectRoot, e);
    return true;
  } catch { return false; }
}
