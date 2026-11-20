/**
 * session-store — mirror de src/session-store.ts
 * Generado desde src/session-store.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Almacén de slots por sesión (session-state-files): índice compartido + archivos de slot.
 *
 * Layout bajo `<opencodeDir>/sessions/`:
 *   index.json        índice (revision, slots, migrated) — escrito bajo lock, atómico (tmp + rename)
 *   pool-NN.json      state de cada slot (formato del controller)
 *
 * La decisión de asignación vive en session-slots.ts (pura). Este módulo hace el I/O.
 * Si el controller MCP o el plugin cambian, deben usar `bindSession` / `checkBinding` de aquí.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_STATE } from "./controller-core.ts";
import { decideSlot, nextRevision, type PoolConfig, type SlotInfo } from "./session-slots.ts";

export interface SlotRecord {
  sessionId: string | null;
  sessionName: string | null;
  requestId: string | null;
  changeId: string | null;
  state: string | null;
  ownerHeartbeat: number;
  assignedAt: number;
  lastUsedAt: number;
  overflow: boolean;
  quarantined: boolean;
  quarantineReason: string | null;
}

export interface SessionIndex {
  version: 1;
  revision: number;
  migrated: boolean;
  slots: Record<string, SlotRecord>;
  /** Sesiones sustituidas por confirmación: bloqueadas hasta iniciar una sesión nueva. */
  replaced?: Record<string, { slot: string; at: number }>;
  /** Última edición validada por archivo (aviso concurrent_edit). */
  fileActivity?: Record<string, { sessionId: string; sessionName: string | null; requestId: string | null; ts: number }>;
}

export interface ConcurrentEditWarning {
  file: string;
  otherName: string;
  otherRequestId: string | null;
  minutesAgo: number;
}

const FILE_ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Registra una edición validada del archivo por la sesión y devuelve avisos si otra sesión lo
 * editó dentro de `windowMs`. No bloquea: solo informa (concurrent_edit).
 */
export function noteFileEdit(opencodeDir: string, sessionId: string, filePath: string, now: number, windowMs: number): ConcurrentEditWarning[] {
  return withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.values(idx.slots).find((r) => r.sessionId === sessionId);
    if (!own) return [];
    const activity = idx.fileActivity ?? {};
    for (const [file, entry] of Object.entries(activity)) {
      if (now - entry.ts > FILE_ACTIVITY_RETENTION_MS) delete activity[file];
    }
    const prev = activity[filePath];
    const warnings: ConcurrentEditWarning[] = [];
    if (prev && prev.sessionId !== sessionId && now - prev.ts <= windowMs) {
      warnings.push({
        file: filePath,
        otherName: prev.sessionName || prev.requestId || "sesión sin nombre",
        otherRequestId: prev.requestId,
        minutesAgo: Math.round((now - prev.ts) / 60000),
      });
    }
    activity[filePath] = { sessionId, sessionName: own.sessionName, requestId: own.requestId, ts: now };
    idx.fileActivity = activity;
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
    return warnings;
  });
}

export type BindResult =
  | { kind: "bound"; slot: string; statePath: string; notify: string[] }
  | { kind: "ask"; candidates: Array<SlotInfo & { sessionName: string | null }>; notify: string[] }
  | { kind: "blocked"; reason: string };

export function sessionsDir(opencodeDir: string): string {
  return join(opencodeDir, "sessions");
}

export function slotPath(opencodeDir: string, slot: string): string {
  return join(sessionsDir(opencodeDir), `${slot}.json`);
}

function indexPath(opencodeDir: string): string {
  return join(sessionsDir(opencodeDir), "index.json");
}

function emptyIndex(): SessionIndex {
  return { version: 1, revision: 0, migrated: false, slots: {} };
}

export function readIndex(opencodeDir: string): SessionIndex {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(opencodeDir), "utf-8"));
    if (parsed && typeof parsed === "object" && parsed.slots && typeof parsed.slots === "object") return parsed as SessionIndex;
  } catch {}
  return emptyIndex();
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Lock de índice: directorio `index.json.lock` creado con mkdir (atómico). Lock viejo (>15s) se libera. */
function withIndexLock<T>(opencodeDir: string, fn: () => T): T {
  mkdirSync(sessionsDir(opencodeDir), { recursive: true });
  const lockDir = indexPath(opencodeDir) + ".lock";
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      mkdirSync(lockDir);
      try {
        return fn();
      } finally {
        try { rmSync(lockDir, { recursive: true, force: true }); } catch {}
      }
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      try {
        const ageMs = Date.now() - statMtime(lockDir);
        if (ageMs > 15_000) rmSync(lockDir, { recursive: true, force: true });
      } catch {}
      sleepSync(10 + Math.floor(Math.random() * 20));
    }
  }
  throw new Error("no se pudo tomar el lock del índice de sesiones");
}

function statMtime(path: string): number {
  return statSync(path).mtimeMs;
}

function toInfo(slot: string, r: SlotRecord): SlotInfo {
  return {
    slot,
    overflow: r.overflow,
    quarantined: r.quarantined,
    sessionId: r.sessionId,
    requestId: r.requestId,
    state: r.state,
    ownerHeartbeat: r.ownerHeartbeat,
    lastUsedAt: r.lastUsedAt,
  };
}

function resetSlotFile(opencodeDir: string, slot: string, previousRevision: number): void {
  const state = { ...structuredClone(DEFAULT_STATE), revision: nextRevision(previousRevision) };
  writeAtomic(slotPath(opencodeDir, slot), JSON.stringify(state, null, 2));
}

function readSlotRevision(opencodeDir: string, slot: string): number {
  try {
    const st = JSON.parse(readFileSync(slotPath(opencodeDir, slot), "utf-8"));
    return typeof st.revision === "number" ? st.revision : 0;
  } catch {
    return 0;
  }
}

/** Valida un archivo de slot; si falla, devuelve el motivo. */
function slotProblem(opencodeDir: string, slot: string): string | null {
  const path = slotPath(opencodeDir, slot);
  if (!existsSync(path)) return null;
  try {
    const st = JSON.parse(readFileSync(path, "utf-8"));
    if (!st || typeof st !== "object" || typeof st.state !== "string") return "estado sin campo state";
    return null;
  } catch (err: any) {
    return `JSON inválido: ${err?.message ?? "error"}`;
  }
}

/**
 * Asigna (o reutiliza) un slot a la sesión. Bajo lock del índice.
 * `replaceSlot` = confirmación explícita del usuario para sustituir un slot ocupado.
 */
export function bindSession(args: {
  opencodeDir: string;
  sessionId: string;
  sessionName?: string | null;
  now: number;
  cfg: PoolConfig;
  legacyStatePath?: string;
  replaceSlot?: string | null;
  /** Confirmación del usuario para crear slots de extensión con 10 activas. */
  allowOverflow?: boolean;
}): BindResult {
  const { opencodeDir, sessionId, now, cfg } = args;
  const name = args.sessionName ?? null;
  return withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);

    // Migración única del state legado al primer slot libre.
    if (!idx.migrated && args.legacyStatePath && existsSync(args.legacyStatePath) && Object.keys(idx.slots).length === 0) {
      const legacy = readFileSync(args.legacyStatePath, "utf-8");
      writeAtomic(slotPath(opencodeDir, "pool-01"), legacy);
      idx.slots["pool-01"] = emptyRecord({ requestId: null });
      idx.migrated = true;
      try { renameSync(args.legacyStatePath, args.legacyStatePath + ".migrated"); } catch {}
    }

    // Cuarentena: slot con archivo inválido no cuenta como libre.
    for (const [slot, rec] of Object.entries(idx.slots)) {
      const problem = slotProblem(opencodeDir, slot);
      if (problem) {
        rec.quarantined = true;
        rec.quarantineReason = problem;
      }
    }

    const view: SlotInfo[] = Object.entries(idx.slots).map(([s, r]) => toInfo(s, r));
    const names = new Map(Object.entries(idx.slots).map(([s, r]) => [s, r.sessionName]));

    // Sustitución confirmada por el usuario.
    if (args.replaceSlot) {
      const target = idx.slots[args.replaceSlot];
      if (!target) return { kind: "blocked", reason: `slot ${args.replaceSlot} no existe` } as BindResult;
      resetSlotFile(opencodeDir, args.replaceSlot, readSlotRevision(opencodeDir, args.replaceSlot));
      if (target.sessionId) {
        idx.replaced = idx.replaced ?? {};
        idx.replaced[target.sessionId] = { slot: args.replaceSlot, at: now };
      }
      Object.assign(target, emptyRecord({ sessionId, sessionName: name, assignedAt: now, lastUsedAt: now, ownerHeartbeat: now, overflow: target.overflow }));
      idx.revision += 1;
      writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
      return { kind: "bound", slot: args.replaceSlot, statePath: slotPath(opencodeDir, args.replaceSlot), notify: [`Slot ${args.replaceSlot} sustituido por confirmación del usuario (slot_takeover).`] };
    }

    const replacedInfo = idx.replaced?.[sessionId];
    if (replacedInfo) {
      return { kind: "blocked", reason: `tu sesión fue sustituida en ${replacedInfo.slot} por confirmación del usuario; iniciá una sesión nueva de OpenCode para continuar` };
    }

    const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId && !r.quarantined);
    if (own) {
      const rec = own[1];
      rec.lastUsedAt = now;
      rec.ownerHeartbeat = now;
      if (name) rec.sessionName = name;
      idx.revision += 1;
      writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
      return { kind: "bound", slot: own[0], statePath: slotPath(opencodeDir, own[0]), notify: [] };
    }

    const decision = decideSlot(sessionId, view, now, cfg, { allowOverflow: !!args.allowOverflow });
    if (decision.kind === "ask") {
      return {
        kind: "ask",
        candidates: decision.candidates.map((c) => ({ ...c, sessionName: names.get(c.slot) ?? null })),
        notify: decision.notify,
      };
    }

    let slot: string;
    let notify: string[] = [];
    if (decision.kind === "create") {
      slot = decision.slot;
      notify = decision.notify;
      idx.slots[slot] = emptyRecord({ overflow: decision.overflow });
      resetSlotFile(opencodeDir, slot, 0);
    } else if (decision.kind === "free") {
      // Libre: conserva el contenido (p. ej. state migrado del legado); no se vacía.
      slot = decision.slot;
      idx.slots[slot] = emptyRecord({ overflow: idx.slots[slot].overflow });
    } else {
      slot = decision.slot;
      notify = decision.notify;
      const overflow = idx.slots[slot].overflow;
      resetSlotFile(opencodeDir, slot, readSlotRevision(opencodeDir, slot));
      idx.slots[slot] = emptyRecord({ overflow });
    }
    const rec = idx.slots[slot];
    rec.sessionId = sessionId;
    rec.sessionName = name;
    rec.assignedAt = now;
    rec.lastUsedAt = now;
    rec.ownerHeartbeat = now;
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
    return { kind: "bound", slot, statePath: slotPath(opencodeDir, slot), notify };
  });
}

function emptyRecord(patch: Partial<SlotRecord> = {}): SlotRecord {
  return {
    sessionId: null,
    sessionName: null,
    requestId: null,
    changeId: null,
    state: null,
    ownerHeartbeat: 0,
    assignedAt: 0,
    lastUsedAt: 0,
    overflow: false,
    quarantined: false,
    quarantineReason: null,
    ...patch,
  };
}

/**
 * Comprueba que el slot de la sesión sigue siendo suyo (no fue sustituido).
 * Lectura sin lock: las escrituras del índice son atómicas (rename).
 */
export function checkBinding(opencodeDir: string, sessionId: string): { ok: true; slot: string } | { ok: false; reason: string } {
  const idx = readIndex(opencodeDir);
  if (idx.replaced?.[sessionId]) return { ok: false, reason: `sesión sustituida en ${idx.replaced[sessionId].slot}` };
  const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
  if (!own) return { ok: false, reason: "la sesión no tiene slot asignado" };
  return { ok: true, slot: own[0] };
}

/** Actualiza el resumen de la request del slot (para listar candidatas y para el aviso de concurrencia). */
export function recordRequestSummary(opencodeDir: string, sessionId: string, summary: { requestId: string | null; changeId: string | null; state: string | null }, now: number): void {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
    if (!own) return;
    Object.assign(own[1], { requestId: summary.requestId, changeId: summary.changeId, state: summary.state, lastUsedAt: now, ownerHeartbeat: now });
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}

/** Renueva el heartbeat de la sesión (cada mutación). */
export function touchSession(opencodeDir: string, sessionId: string, now: number): void {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
    if (!own) return;
    own[1].ownerHeartbeat = now;
    own[1].lastUsedAt = now;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}

/** Resumen del pool para `doctor` y para la pregunta al usuario. Solo lectura. */
export function poolReport(opencodeDir: string, now: number, cfg: PoolConfig): {
  base: number; overflow: number; active: number; quarantined: string[]; occupied: Array<SlotInfo & { sessionName: string | null }>;
} {
  const idx = readIndex(opencodeDir);
  const entries = Object.entries(idx.slots);
  const infos = entries.map(([s, r]) => toInfo(s, r));
  const active = infos.filter((i) => i.sessionId && i.requestId && i.ownerHeartbeat > 0 && now - i.ownerHeartbeat <= cfg.activeMs && !["DONE", "ABANDONED"].includes(i.state ?? "")).length;
  return {
    base: entries.filter(([, r]) => !r.overflow).length,
    overflow: entries.filter(([, r]) => r.overflow).length,
    active,
    quarantined: entries.filter(([, r]) => r.quarantined).map(([s, r]) => `${s}: ${r.quarantineReason ?? "motivo desconocido"}`),
    occupied: infos
      .filter((i) => i.sessionId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
      .map((i) => ({ ...i, sessionName: idx.slots[i.slot].sessionName })),
  };
}


/** Prefijo del archivo de handoff de compaction (uno por sesión; sin sesión, el nombre legado). */
export const HANDOFF_FALLBACK_BASE = ".ostacky-handoff-compaction";

/**
 * Ruta del fallback de compaction de una sesión. Ancla fija: el directorio .opencode del proyecto
 * (no el de un slot). Con OSTACKY_SESSION_SLOTS=off o sin sesión usa el nombre legado.
 */
export function handoffFallbackPath(opencodeDir: string, sessionId?: string | null): string {
  const sid = process.env.OSTACKY_SESSION_SLOTS === "off" ? null : sessionId;
  const key = sid ? sid.replace(/[^A-Za-z0-9_-]/g, "_") : null;
  return join(opencodeDir, key ? `${HANDOFF_FALLBACK_BASE}-${key}.json` : `${HANDOFF_FALLBACK_BASE}.json`);
}

/** true si el nombre es un archivo de fallback de compaction (legado o por sesión). */
export function isHandoffFallbackFile(name: string): boolean {
  return name === HANDOFF_FALLBACK_BASE + ".json" || (name.startsWith(HANDOFF_FALLBACK_BASE + "-") && name.endsWith(".json"));
}
