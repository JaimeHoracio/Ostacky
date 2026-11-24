import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindSession, checkBinding, clearCompactOptOut, hasCompactOptOut, noteFileEdit, poolReport, readIndex,
  recordCompactOptOut, recordRequestSummary, slotPath, touchSession,
} from "../src/session-store.ts";
import { parsePoolConfig } from "../src/session-slots.ts";

const DAY = 86_400_000;
const NOW = 200 * DAY;
const cfg = parsePoolConfig({});
let root: string;
let opencodeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ostacky-slots-"));
  opencodeDir = join(root, ".opencode");
  mkdirSync(opencodeDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("session-store — asignación", () => {
  it("cada sesión recibe su slot y la misma sesión reutiliza el suyo", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", sessionName: "Refactor login", now: NOW, cfg });
    const b = bindSession({ opencodeDir, sessionId: "sesB", sessionName: "Tests pagos", now: NOW, cfg });
    expect(a.kind).toBe("bound");
    expect(b.kind).toBe("bound");
    if (a.kind === "bound" && b.kind === "bound") {
      expect(a.slot).not.toBe(b.slot);
      expect(existsSync(a.statePath)).toBe(true);
      const again = bindSession({ opencodeDir, sessionId: "sesA", now: NOW + 1000, cfg });
      expect(again).toMatchObject({ kind: "bound", slot: a.slot });
    }
    expect(readIndex(opencodeDir).slots[(a as any).slot].sessionName).toBe("Refactor login");
  });

  it("checkBinding detecta una sesión sin slot", () => {
    expect(checkBinding(opencodeDir, "nadie").ok).toBe(false);
  });
});

describe("session-store — migración y cuarentena", () => {
  it("migra el state legado al primer slot una sola vez", () => {
    const legacy = join(opencodeDir, "ostacky-state.json");
    writeFileSync(legacy, JSON.stringify({ state: "EXECUTING_INLINE", revision: 7, requestId: "req-old" }));
    const r = bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg, legacyStatePath: legacy });
    expect(r).toMatchObject({ kind: "bound", slot: "pool-01" });
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(legacy + ".migrated")).toBe(true);
    expect(JSON.parse(readFileSync(slotPath(opencodeDir, "pool-01"), "utf-8")).requestId).toBe("req-old");
    expect(readIndex(opencodeDir).migrated).toBe(true);
  });

  it("slot con JSON inválido queda en cuarentena y no se asigna", () => {
    mkdirSync(join(opencodeDir, "sessions"), { recursive: true });
    writeFileSync(slotPath(opencodeDir, "pool-01"), "{not json");
    const idx = { version: 1, revision: 1, migrated: true, slots: { "pool-01": { sessionId: null, sessionName: null, requestId: null, changeId: null, state: null, ownerHeartbeat: 0, assignedAt: 0, lastUsedAt: 0, overflow: false, quarantined: false, quarantineReason: null } } };
    writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(idx));
    const r = bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    expect(r).toMatchObject({ kind: "bound", slot: "pool-02" });
    expect(poolReport(opencodeDir, NOW, cfg).quarantined[0]).toContain("pool-01");
  });
});

describe("session-store — sustitución y heartbeat", () => {
  it("sustitución confirmada: la sesión anterior queda sin slot (BLOCKED)", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", sessionName: "Pagos", now: NOW, cfg });
    if (a.kind !== "bound") throw new Error("setup");
    recordRequestSummary(opencodeDir, "sesA", { requestId: "req-A", changeId: "pagos", state: "EXECUTING_INLINE" }, NOW);
    const b = bindSession({ opencodeDir, sessionId: "sesB", now: NOW, cfg, replaceSlot: a.slot });
    expect(b).toMatchObject({ kind: "bound", slot: a.slot });
    expect(checkBinding(opencodeDir, "sesA").ok).toBe(false);
    expect(checkBinding(opencodeDir, "sesB")).toEqual({ ok: true, slot: a.slot });
    expect(JSON.parse(readFileSync(a.statePath, "utf-8")).requestId).toBeNull();
  });

  it("revisión del slot nunca retrocede al reciclar", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    if (a.kind !== "bound") throw new Error("setup");
    wf(a.statePath, JSON.stringify({ state: "DONE", revision: 41, requestId: "r" }));
    recordRequestSummary(opencodeDir, "sesA", { requestId: "r", changeId: null, state: "DONE" }, NOW - 9 * DAY);
    // Sesión A sin uso hace 9 días → elegible. Ocupamos el resto del pool para forzar reciclaje.
    const idx = readIndex(opencodeDir);
    idx.slots[a.slot].lastUsedAt = NOW - 9 * DAY;
    writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(idx));
    for (let i = 2; i <= cfg.poolMax; i++) {
      const s = readIndex(opencodeDir);
      s.slots[`pool-${String(i).padStart(2, "0")}`] = { ...s.slots[a.slot], sessionId: `x${i}`, requestId: "live", state: "EXECUTING_INLINE", ownerHeartbeat: NOW, lastUsedAt: NOW, overflow: false, quarantined: false, quarantineReason: null, sessionName: null, assignedAt: NOW, changeId: null };
      writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(s));
      wf(slotPath(opencodeDir, `pool-${String(i).padStart(2, "0")}`), JSON.stringify({ state: "EXECUTING_INLINE", revision: 1, requestId: "live" }));
    }
    const r = bindSession({ opencodeDir, sessionId: "nueva", now: NOW, cfg });
    expect(r).toMatchObject({ kind: "bound", slot: a.slot });
    expect(JSON.parse(readFileSync(a.statePath, "utf-8")).revision).toBe(42);
  });

  it("touchSession renueva heartbeat; poolReport cuenta activas", () => {
    bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    touchSession(opencodeDir, "sesA", NOW + 5 * 60_000);
    const rep = poolReport(opencodeDir, NOW + 6 * 60_000, cfg);
    expect(rep.base).toBe(1);
    expect(rep.occupied[0].ownerHeartbeat).toBe(NOW + 5 * 60_000);
  });
});

describe("session-store — pregunta con nombres", () => {
  it("con el pool lleno y sin elegibles, pregunta con nombres de sesión, no con ids", () => {
    // 10 base ocupados por sesiones activas + 5 extensiones activas: tope absoluto.
    mkdirSync(join(opencodeDir, "sessions"), { recursive: true });
    const idx = { version: 1, revision: 1, migrated: true, slots: {} as any };
    for (let i = 1; i <= 15; i++) {
      const slot = `pool-${String(i).padStart(2, "0")}`;
      idx.slots[slot] = { sessionId: `sid-${i}`, sessionName: `Sesión ${i}`, requestId: `r${i}`, changeId: null, state: "EXECUTING_INLINE", ownerHeartbeat: NOW - 60_000, assignedAt: NOW, lastUsedAt: NOW - i * 60_000, overflow: i > 10, quarantined: false, quarantineReason: null };
      wf(slotPath(opencodeDir, slot), JSON.stringify({ state: "EXECUTING_INLINE", revision: 1, requestId: `r${i}` }));
    }
    mkdirSync(join(opencodeDir, "sessions"), { recursive: true });
    writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(idx));
    const r = bindSession({ opencodeDir, sessionId: "nueva", now: NOW, cfg });
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") {
      expect(r.candidates[0].sessionName).toBe("Sesión 15");
      expect(r.candidates[0].sessionId).toBe("sid-15");
      expect(r.notify.join(" ")).toContain("Ya hay 10 sesiones activas");
    }
  });
});

describe("session-store — concurrencia real entre procesos", () => {
  it("dos procesos que se asignan a la vez obtienen slots distintos", async () => {
    const script = join(root, "bind.ts");
    const storeUrl = join(process.cwd(), "src", "session-store.ts");
    const cfgUrl = join(process.cwd(), "src", "session-slots.ts");
    writeFileSync(
      script,
      `import { bindSession } from ${JSON.stringify(storeUrl)};
import { parsePoolConfig } from ${JSON.stringify(cfgUrl)};
const r = bindSession({ opencodeDir: process.argv[2], sessionId: process.argv[3], now: Date.now(), cfg: parsePoolConfig({}) });
console.log(JSON.stringify(r));`,
    );
    const procs = ["p1", "p2", "p3", "p4"].map((sid) =>
      Bun.spawn(["bun", script, opencodeDir, sid], { stdout: "pipe", stderr: "pipe" }),
    );
    const outs = await Promise.all(procs.map(async (p) => JSON.parse((await new Response(p.stdout).text()).trim())));
    const slots = outs.map((o) => o.slot);
    expect(outs.every((o) => o.kind === "bound")).toBe(true);
    expect(new Set(slots).size).toBe(4);
    expect(Object.values(readIndex(opencodeDir).slots).filter((s) => s.sessionId).length).toBe(4);
  }, 30_000);
});

describe("session-store — concurrent_edit (aviso, no bloqueo)", () => {
  it("avisa si otra sesión editó el archivo dentro de la ventana; no a la misma sesión", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", sessionName: "Pagos", now: NOW, cfg });
    const b = bindSession({ opencodeDir, sessionId: "sesB", sessionName: "Login", now: NOW, cfg });
    expect(a.kind).toBe("bound");
    expect(b.kind).toBe("bound");
    const W = 30 * 60_000;
    expect(noteFileEdit(opencodeDir, "sesA", "src/x.ts", NOW, W)).toEqual([]);
    const w = noteFileEdit(opencodeDir, "sesB", "src/x.ts", NOW + 10 * 60_000, W);
    expect(w).toEqual([{ file: "src/x.ts", otherName: "Pagos", otherRequestId: null, minutesAgo: 10 }]);
    expect(noteFileEdit(opencodeDir, "sesB", "src/x.ts", NOW + 11 * 60_000, W)).toEqual([]);
  });

  it("fuera de la ventana no avisa", () => {
    bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    bindSession({ opencodeDir, sessionId: "sesB", now: NOW, cfg });
    noteFileEdit(opencodeDir, "sesA", "src/y.ts", NOW, 30 * 60_000);
    expect(noteFileEdit(opencodeDir, "sesB", "src/y.ts", NOW + 31 * 60_000, 30 * 60_000)).toEqual([]);
  });

  it("sesión sustituida o sin slot no registra ni avisa", () => {
    expect(noteFileEdit(opencodeDir, "nadie", "src/z.ts", NOW, 30 * 60_000)).toEqual([]);
  });
});

describe("session-store — opt-out de compactación", () => {
  it("sobrevive al reinicio del plugin y no afecta a otra sesión", () => {
    bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    bindSession({ opencodeDir, sessionId: "sesB", now: NOW, cfg });
    recordCompactOptOut(opencodeDir, "sesA", NOW);
    // "reinicio": el estado se relee de disco, no de memoria
    expect(readIndex(opencodeDir).compactOptOut?.sesA?.at).toBe(NOW);
    expect(hasCompactOptOut(opencodeDir, "sesA")).toBe(true);
    expect(hasCompactOptOut(opencodeDir, "sesB")).toBe(false);
  });

  it("se purga cuando la sesión es sustituida", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", sessionName: "Pagos", now: NOW, cfg });
    if (a.kind !== "bound") throw new Error("setup");
    recordCompactOptOut(opencodeDir, "sesA", NOW);
    bindSession({ opencodeDir, sessionId: "sesB", now: NOW, cfg, replaceSlot: a.slot });
    expect(hasCompactOptOut(opencodeDir, "sesA")).toBe(false);
    expect(hasCompactOptOut(opencodeDir, "sesB")).toBe(false);
  });

  it("se purga al reciclar el slot y clearCompactOptOut es idempotente", () => {
    const a = bindSession({ opencodeDir, sessionId: "sesA", now: NOW, cfg });
    if (a.kind !== "bound") throw new Error("setup");
    recordCompactOptOut(opencodeDir, "sesA", NOW);
    const idx = readIndex(opencodeDir);
    idx.slots[a.slot].lastUsedAt = NOW - 9 * DAY;
    writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(idx));
    for (let i = 2; i <= cfg.poolMax; i++) {
      const s = readIndex(opencodeDir);
      const slot = `pool-${String(i).padStart(2, "0")}`;
      s.slots[slot] = { ...s.slots[a.slot], sessionId: `x${i}`, requestId: "live", state: "EXECUTING_INLINE", ownerHeartbeat: NOW, lastUsedAt: NOW, overflow: false, quarantined: false, quarantineReason: null, sessionName: null, assignedAt: NOW, changeId: null };
      writeFileSync(join(opencodeDir, "sessions", "index.json"), JSON.stringify(s));
      wf(slotPath(opencodeDir, slot), JSON.stringify({ state: "EXECUTING_INLINE", revision: 1, requestId: "live" }));
    }
    const r = bindSession({ opencodeDir, sessionId: "nueva", now: NOW, cfg });
    expect(r).toMatchObject({ kind: "bound", slot: a.slot });
    expect(hasCompactOptOut(opencodeDir, "sesA")).toBe(false);
    clearCompactOptOut(opencodeDir, "sesA");
    expect(hasCompactOptOut(opencodeDir, "sesA")).toBe(false);
  });
});
