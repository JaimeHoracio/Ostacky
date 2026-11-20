import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistState, readState, resolveStatePath } from "../assets/plugins/ostacky-controller/index.ts";
import { bindSession } from "../src/session-store.ts";
import { parsePoolConfig } from "../src/session-slots.ts";

let root: string;
let prevEnv: string | undefined;
let prevState: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ostacky-plugin-slot-"));
  mkdirSync(join(root, ".opencode"), { recursive: true });
  prevEnv = process.env.OSTACKY_SESSION_SLOTS;
  prevState = process.env.OSTACKY_STATE_PATH;
  delete process.env.OSTACKY_SESSION_SLOTS;
  process.env.OSTACKY_STATE_PATH = join(root, ".opencode", "ostacky-state.json");
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.OSTACKY_SESSION_SLOTS; else process.env.OSTACKY_SESSION_SLOTS = prevEnv;
  if (prevState === undefined) delete process.env.OSTACKY_STATE_PATH; else process.env.OSTACKY_STATE_PATH = prevState;
  rmSync(root, { recursive: true, force: true });
});

describe("plugin — resolución de slot por sesión", () => {
  it("sin sessionId o sin slot asignado no hay state (no se toca el legado)", () => {
    expect(resolveStatePath(root, undefined)).toBeNull();
    expect(resolveStatePath(root, "default")).toBeNull();
    expect(resolveStatePath(root, "sin-slot")).toBeNull();
    expect(readState(root, "sin-slot")).toBeNull();
    persistState(root, { state: "DONE" }, ["lastHeartbeat"], "sin-slot");
    expect(() => readFileSync(join(root, ".opencode", "ostacky-state.json"))).toThrow();
  });

  it("cada sesión lee y escribe SU slot", () => {
    const cfg = parsePoolConfig({});
    const a = bindSession({ opencodeDir: join(root, ".opencode"), sessionId: "sesA", now: Date.now(), cfg });
    const b = bindSession({ opencodeDir: join(root, ".opencode"), sessionId: "sesB", now: Date.now(), cfg });
    if (a.kind !== "bound" || b.kind !== "bound") throw new Error("setup");
    persistState(root, { state: "EXECUTING_INLINE", revision: 5, requestId: "req-A" }, ["requestId", "state", "revision"], "sesA");
    expect(readState(root, "sesA").requestId).toBe("req-A");
    expect(readState(root, "sesB")?.requestId ?? null).not.toBe("req-A");
    expect(resolveStatePath(root, "sesA")).toBe(a.statePath);
  });

  it("OSTACKY_SESSION_SLOTS=off usa el state único legado", () => {
    process.env.OSTACKY_SESSION_SLOTS = "off";
    expect(resolveStatePath(root, undefined)).toBe(join(root, ".opencode", "ostacky-state.json"));
  });
});
