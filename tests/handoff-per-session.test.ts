import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handoffFallbackPath, isHandoffFallbackFile } from "../src/session-store.ts";
import { recoveryPending } from "../assets/plugins/ostacky-controller/index.ts";

let root = "";
let prevSlots: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ostacky-handoff-"));
  mkdirSync(join(root, ".opencode"), { recursive: true });
  prevSlots = process.env.OSTACKY_SESSION_SLOTS;
  delete process.env.OSTACKY_SESSION_SLOTS;
});
afterEach(() => {
  if (prevSlots === undefined) delete process.env.OSTACKY_SESSION_SLOTS; else process.env.OSTACKY_SESSION_SLOTS = prevSlots;
  rmSync(root, { recursive: true, force: true });
});

describe("handoffFallbackPath / isHandoffFallbackFile", () => {
  it("nombre por sesión con ancla .opencode fija", () => {
    expect(handoffFallbackPath("/p/.opencode", "ses_A1")).toBe("/p/.opencode/.ostacky-handoff-compaction-ses_A1.json");
  });
  it("sin sesión usa el nombre legado", () => {
    expect(handoffFallbackPath("/p/.opencode", null)).toBe("/p/.opencode/.ostacky-handoff-compaction.json");
  });
  it("sanea caracteres fuera de [A-Za-z0-9_-] (sin traversal)", () => {
    expect(handoffFallbackPath("/p/.opencode", "../x/y")).toBe("/p/.opencode/.ostacky-handoff-compaction-___x_y.json");
  });
  it("con OSTACKY_SESSION_SLOTS=off ignora la sesión", () => {
    process.env.OSTACKY_SESSION_SLOTS = "off";
    expect(handoffFallbackPath("/p/.opencode", "ses_A")).toBe("/p/.opencode/.ostacky-handoff-compaction.json");
  });
  it("reconoce legado y por sesión, no otros archivos", () => {
    expect(isHandoffFallbackFile(".ostacky-handoff-compaction.json")).toBe(true);
    expect(isHandoffFallbackFile(".ostacky-handoff-compaction-ses_A.json")).toBe(true);
    expect(isHandoffFallbackFile("ostacky-state.json")).toBe(false);
    expect(isHandoffFallbackFile(".ostacky-handoff-compaction-ses_A.json.tmp.1")).toBe(false);
  });
});

describe("recovery hint no cruza sesiones", () => {
  const state = { state: "EXECUTING_INLINE", tasks: {} };
  it("la sesión que compactó ve sus pendientes; otra sesión no los recibe", () => {
    const dir = join(root, ".opencode");
    writeFileSync(
      handoffFallbackPath(dir, "sesA"),
      JSON.stringify({ summary: "x", pendingTasks: ["T3", "T5"], nextSteps: ["T3"], ts: Date.now() })
    );
    expect(recoveryPending(state, root, "sesA").pending).toEqual(["T3", "T5"]);
    expect(recoveryPending(state, root, "sesB").pending).toEqual([]);
    expect(existsSync(handoffFallbackPath(dir, "sesB"))).toBe(false);
  });
});
