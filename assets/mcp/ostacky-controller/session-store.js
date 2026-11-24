/**
 * session-store — mirror (JS) de src/session-store.ts
 * Generado desde src/session-store.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_STATE } from "./controller-core.js";
import { decideSlot, isActiveSlot, nextRevision } from "./session-slots.js";
const FILE_ACTIVITY_RETENTION_MS = 24 * 60 * 60 * 1000;
export function noteFileEdit(opencodeDir, sessionId, filePath, now, windowMs) {
  return withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.values(idx.slots).find((r) => r.sessionId === sessionId);
    if (!own)
      return [];
    const activity = idx.fileActivity ?? {};
    for (const [file, entry] of Object.entries(activity)) {
      if (now - entry.ts > FILE_ACTIVITY_RETENTION_MS)
        delete activity[file];
    }
    const prev = activity[filePath];
    const warnings = [];
    if (prev && prev.sessionId !== sessionId && now - prev.ts <= windowMs) {
      warnings.push({
        file: filePath,
        otherName: prev.sessionName || prev.requestId || "sesión sin nombre",
        otherRequestId: prev.requestId,
        minutesAgo: Math.round((now - prev.ts) / 60000)
      });
    }
    activity[filePath] = { sessionId, sessionName: own.sessionName, requestId: own.requestId, ts: now };
    idx.fileActivity = activity;
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
    return warnings;
  });
}
export function sessionsDir(opencodeDir) {
  return join(opencodeDir, "sessions");
}
export function slotPath(opencodeDir, slot) {
  return join(sessionsDir(opencodeDir), `${slot}.json`);
}
function indexPath(opencodeDir) {
  return join(sessionsDir(opencodeDir), "index.json");
}
function emptyIndex() {
  return { version: 1, revision: 0, migrated: false, slots: {} };
}
export function readIndex(opencodeDir) {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(opencodeDir), "utf-8"));
    if (parsed && typeof parsed === "object" && parsed.slots && typeof parsed.slots === "object")
      return parsed;
  } catch {}
  return emptyIndex();
}
function writeAtomic(path, content) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function withIndexLock(opencodeDir, fn) {
  mkdirSync(sessionsDir(opencodeDir), { recursive: true });
  const lockDir = indexPath(opencodeDir) + ".lock";
  for (let attempt = 0;attempt < 200; attempt++) {
    try {
      mkdirSync(lockDir);
      try {
        return fn();
      } finally {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {}
      }
    } catch (err) {
      if (err?.code !== "EEXIST")
        throw err;
      try {
        const ageMs = Date.now() - statMtime(lockDir);
        if (ageMs > 15000)
          rmSync(lockDir, { recursive: true, force: true });
      } catch {}
      sleepSync(10 + Math.floor(Math.random() * 20));
    }
  }
  throw new Error("no se pudo tomar el lock del índice de sesiones");
}
function statMtime(path) {
  return statSync(path).mtimeMs;
}
function toInfo(slot, r) {
  return {
    slot,
    overflow: r.overflow,
    quarantined: r.quarantined,
    sessionId: r.sessionId,
    requestId: r.requestId,
    state: r.state,
    ownerHeartbeat: r.ownerHeartbeat,
    lastUsedAt: r.lastUsedAt
  };
}
function resetSlotFile(opencodeDir, slot, previousRevision) {
  const state = { ...structuredClone(DEFAULT_STATE), revision: nextRevision(previousRevision) };
  writeAtomic(slotPath(opencodeDir, slot), JSON.stringify(state, null, 2));
}
function readSlotRevision(opencodeDir, slot) {
  try {
    const st = JSON.parse(readFileSync(slotPath(opencodeDir, slot), "utf-8"));
    return typeof st.revision === "number" ? st.revision : 0;
  } catch {
    return 0;
  }
}
function slotProblem(opencodeDir, slot) {
  const path = slotPath(opencodeDir, slot);
  if (!existsSync(path))
    return null;
  try {
    const st = JSON.parse(readFileSync(path, "utf-8"));
    if (!st || typeof st !== "object" || typeof st.state !== "string")
      return "estado sin campo state";
    return null;
  } catch (err) {
    return `JSON inválido: ${err?.message ?? "error"}`;
  }
}
export function bindSession(args) {
  const { opencodeDir, sessionId, now, cfg } = args;
  const name = args.sessionName ?? null;
  return withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    if (!idx.migrated && args.legacyStatePath && existsSync(args.legacyStatePath) && Object.keys(idx.slots).length === 0) {
      const legacy = readFileSync(args.legacyStatePath, "utf-8");
      writeAtomic(slotPath(opencodeDir, "pool-01"), legacy);
      idx.slots["pool-01"] = emptyRecord({ requestId: null });
      idx.migrated = true;
      try {
        renameSync(args.legacyStatePath, args.legacyStatePath + ".migrated");
      } catch {}
    }
    for (const [slot, rec] of Object.entries(idx.slots)) {
      const problem = slotProblem(opencodeDir, slot);
      if (problem) {
        rec.quarantined = true;
        rec.quarantineReason = problem;
      }
    }
    const view = Object.entries(idx.slots).map(([s, r]) => toInfo(s, r));
    const names = new Map(Object.entries(idx.slots).map(([s, r]) => [s, r.sessionName]));
    if (args.replaceSlot) {
      const target = idx.slots[args.replaceSlot];
      if (!target)
        return { kind: "blocked", reason: `slot ${args.replaceSlot} no existe` };
      resetSlotFile(opencodeDir, args.replaceSlot, readSlotRevision(opencodeDir, args.replaceSlot));
      if (target.sessionId) {
        idx.replaced = idx.replaced ?? {};
        idx.replaced[target.sessionId] = { slot: args.replaceSlot, at: now };
        if (idx.compactOptOut)
          delete idx.compactOptOut[target.sessionId];
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
      if (name)
        rec.sessionName = name;
      idx.revision += 1;
      writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
      return { kind: "bound", slot: own[0], statePath: slotPath(opencodeDir, own[0]), notify: [] };
    }
    const decision = decideSlot(sessionId, view, now, cfg, { allowOverflow: !!args.allowOverflow });
    if (decision.kind === "ask") {
      return {
        kind: "ask",
        candidates: decision.candidates.map((c) => ({ ...c, sessionName: names.get(c.slot) ?? null })),
        notify: decision.notify
      };
    }
    let slot;
    let notify = [];
    if (decision.kind === "create") {
      slot = decision.slot;
      notify = decision.notify;
      idx.slots[slot] = emptyRecord({ overflow: decision.overflow });
      resetSlotFile(opencodeDir, slot, 0);
    } else if (decision.kind === "free") {
      slot = decision.slot;
      idx.slots[slot] = emptyRecord({ overflow: idx.slots[slot].overflow });
    } else {
      slot = decision.slot;
      if (decision.kind === "recycle")
        notify = decision.notify;
      const overflow = idx.slots[slot].overflow;
      const previous = idx.slots[slot].sessionId;
      if (previous && idx.compactOptOut)
        delete idx.compactOptOut[previous];
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
function emptyRecord(patch = {}) {
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
    ...patch
  };
}
export function checkBinding(opencodeDir, sessionId) {
  const idx = readIndex(opencodeDir);
  if (idx.replaced?.[sessionId])
    return { ok: false, reason: `sesión sustituida en ${idx.replaced[sessionId].slot}` };
  const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
  if (!own)
    return { ok: false, reason: "la sesión no tiene slot asignado" };
  return { ok: true, slot: own[0] };
}
export function recordCompactOptOut(opencodeDir, sessionId, now) {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    idx.compactOptOut = idx.compactOptOut ?? {};
    idx.compactOptOut[sessionId] = { at: now };
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}
export function hasCompactOptOut(opencodeDir, sessionId) {
  return !!readIndex(opencodeDir).compactOptOut?.[sessionId];
}
export function clearCompactOptOut(opencodeDir, sessionId) {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    if (!idx.compactOptOut?.[sessionId])
      return;
    delete idx.compactOptOut[sessionId];
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}
export function recordRequestSummary(opencodeDir, sessionId, summary, now) {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
    if (!own)
      return;
    Object.assign(own[1], { requestId: summary.requestId, changeId: summary.changeId, state: summary.state, lastUsedAt: now, ownerHeartbeat: now });
    idx.revision += 1;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}
export function touchSession(opencodeDir, sessionId, now) {
  withIndexLock(opencodeDir, () => {
    const idx = readIndex(opencodeDir);
    const own = Object.entries(idx.slots).find(([, r]) => r.sessionId === sessionId);
    if (!own)
      return;
    own[1].ownerHeartbeat = now;
    own[1].lastUsedAt = now;
    writeAtomic(indexPath(opencodeDir), JSON.stringify(idx, null, 2));
  });
}
export function poolReport(opencodeDir, now, cfg) {
  const idx = readIndex(opencodeDir);
  const entries = Object.entries(idx.slots);
  const infos = entries.map(([s, r]) => toInfo(s, r));
  const active = infos.filter((i) => i.sessionId && i.requestId && i.ownerHeartbeat > 0 && now - i.ownerHeartbeat <= cfg.activeMs && !["DONE", "ABANDONED"].includes(i.state ?? "")).length;
  return {
    base: entries.filter(([, r]) => !r.overflow).length,
    overflow: entries.filter(([, r]) => r.overflow).length,
    active,
    quarantined: entries.filter(([, r]) => r.quarantined).map(([s, r]) => `${s}: ${r.quarantineReason ?? "motivo desconocido"}`),
    occupied: infos.filter((i) => i.sessionId).sort((a, b) => a.lastUsedAt - b.lastUsedAt).map((i) => ({ ...i, sessionName: idx.slots[i.slot].sessionName, active: isActiveSlot(i, now, cfg) }))
  };
}
export const HANDOFF_FALLBACK_BASE = ".ostacky-handoff-compaction";
export function handoffFallbackPath(opencodeDir, sessionId) {
  const sid = process.env.OSTACKY_SESSION_SLOTS === "off" ? null : sessionId;
  const key = sid ? sid.replace(/[^A-Za-z0-9_-]/g, "_") : null;
  return join(opencodeDir, key ? `${HANDOFF_FALLBACK_BASE}-${key}.json` : `${HANDOFF_FALLBACK_BASE}.json`);
}
export function isHandoffFallbackFile(name) {
  return name === HANDOFF_FALLBACK_BASE + ".json" || name.startsWith(HANDOFF_FALLBACK_BASE + "-") && name.endsWith(".json");
}
