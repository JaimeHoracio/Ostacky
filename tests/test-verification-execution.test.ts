import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OstackyController, findTestEvidence } from "../assets/mcp/ostacky-controller/index.js";
import { isMutatingTool, isShellMutation, shellEvidence } from "../assets/plugins/ostacky-controller/index.ts";
import { isMaskedExitCommand, normalizeTestCommand } from "../src/controller-core.ts";

const TMP_PREFIX = join(tmpdir(), "ostacky-test-evidence-");
let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(TMP_PREFIX);
});
afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function statePath(name = "ostacky-state.json"): string {
    mkdirSync(join(tmp, ".opencode"), { recursive: true });
    return join(tmp, ".opencode", name);
}

const CMD = "bun test tests/domains/settle.test.ts";

function run(cmd: string, exit: number, ts: number) {
    return { cmd, exit, ts };
}

describe("normalizeTestCommand: transformaciones neutras y operadores rechazados", () => {
    it("recorta el prefijo cd y el 2>&1", () => {
        expect(normalizeTestCommand(`cd /repo && ${CMD}`)).toBe(CMD);
        expect(normalizeTestCommand(`${CMD} 2>&1`)).toBe(CMD);
        expect(normalizeTestCommand(`cd /repo && ${CMD} 2>&1`)).toBe(CMD);
    });

    it("recorta el pipe a pager para comparar y lo marca como enmascarado", () => {
        expect(normalizeTestCommand(`cd /repo && ${CMD} 2>&1 | tail -35`)).toBe(CMD);
        expect(isMaskedExitCommand(`cd /repo && ${CMD} 2>&1 | tail -35`)).toBe(true);
        expect(isMaskedExitCommand(`${CMD} | grep -i foo | head -3`)).toBe(true);
        expect(isMaskedExitCommand(CMD)).toBe(false);
    });

    it("no acepta operadores que alteran el resultado", () => {
        for (const cmd of [
            `${CMD} || true`,
            `${CMD}; echo ok`,
            `${CMD} && echo done`,
            "echo x > out.txt",
            `${CMD} | cat`,
        ]) {
            expect(normalizeTestCommand(cmd)).toBe("");
        }
    });
});

describe("findTestEvidence: test: exige evidencia, no un sello de goma", () => {
    it("acepta una corrida verde posterior a la última edición", () => {
        const r = findTestEvidence({
            runs: [run(CMD, 0, 2_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
            now: 3_000,
        });
        expect(r.ok).toBe(true);
        expect(r.reason).toContain("exit 0");
    });

    it("rechaza una corrida con exit distinto de cero", () => {
        const r = findTestEvidence({ runs: [run(CMD, 1, 2_000)], cmd: CMD, lastMutationTs: 1_000 });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("exit 1");
    });

    it("rechaza una corrida anterior a la última edición", () => {
        const r = findTestEvidence({ runs: [run(CMD, 0, 1_000)], cmd: CMD, lastMutationTs: 1_000 });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("anterior a la última edición");
    });

    it("rechaza si el comando declarado nunca se ejecutó", () => {
        const r = findTestEvidence({
            runs: [run("bun test tests/otro.test.ts", 0, 2_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("nunca se ejecutó exactamente");
    });

    it("no acepta un comando distinto aunque también pase", () => {
        const r = findTestEvidence({
            runs: [run(`${CMD} || true`, 0, 2_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
    });

    it("sin corridas registradas falla cerrado y nombra al plugin", () => {
        const r = findTestEvidence({ runs: undefined, cmd: CMD, lastMutationTs: 1_000 });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("plugin");
    });

    it("sin timestamps no puede probar que la corrida sea posterior", () => {
        const r = findTestEvidence({ runs: [run(CMD, 0, 2_000)], cmd: CMD });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("sin timestamps");
    });

    it("mira la corrida MÁS RECIENTE del comando, no la primera verde", () => {
        const r = findTestEvidence({
            runs: [run(CMD, 0, 2_000), run(CMD, 3, 4_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("exit 3");
    });

    it("normaliza espacios del comando declarado y de la corrida", () => {
        const r = findTestEvidence({
            runs: [run(`  ${CMD}  `, 0, 2_000)],
            cmd: ` ${CMD} `,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(true);
    });

    it("acepta la forma real cd … && … 2>&1", () => {
        const r = findTestEvidence({
            runs: [run(`cd /repo && ${CMD} 2>&1`, 0, 2_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(true);
    });

    it("rechaza un exit enmascarado por pipe aunque sea 0", () => {
        const r = findTestEvidence({
            runs: [run(`cd /repo && ${CMD} 2>&1 | tail -35`, 0, 2_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("enmascarado");
        expect(r.reason).toContain("pipefail");
    });

    it("si la última corrida está enmascarada, no vale una verde anterior", () => {
        const r = findTestEvidence({
            runs: [run(CMD, 0, 2_000), run(`${CMD} 2>&1 | tail -5`, 0, 4_000)],
            cmd: CMD,
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("enmascarado");
    });

    it("sin corridas nombra el comando declarado y no culpa al plugin de no correr", () => {
        const r = findTestEvidence({ runs: [], cmd: CMD, lastMutationTs: 1_000 });
        expect(r.reason).toContain(CMD);
        expect(r.reason).not.toContain("¿está corriendo?");
    });

    it("sin match nombra la corrida más parecida", () => {
        const r = findTestEvidence({
            runs: [run(`cd /repo && ${CMD} 2>&1`, 0, 2_000), run("bun test tests/otro.test.ts", 0, 3_000)],
            cmd: "bun test tests/otro2.test.ts",
            lastMutationTs: 1_000,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("La corrida más parecida");
    });

    it("un test: declarado con operadores no es verificable", () => {
        const r = findTestEvidence({ runs: [], cmd: `${CMD} || true`, lastMutationTs: 1_000 });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain("no verificable");
    });
});

describe("shellEvidence: el `status` no es evidencia", () => {
    it("registra el exit REAL de un comando que falla", () => {
        // Medido en OpenCode 2.0.32: exit 3 llega con status "completed".
        const ev = shellEvidence({
            tool: "shell",
            status: "completed",
            input: { command: "sh -c 'exit 3'" },
            result: { metadata: { status: "completed", exit: 3 } },
        });
        expect(ev).not.toBeNull();
        expect(ev?.exit).toBe(3);
        expect(ev?.cmd).toBe("sh -c 'exit 3'");
    });

    it("devuelve null si no hay metadata.exit (fail-closed)", () => {
        expect(
            shellEvidence({
                tool: "shell",
                status: "completed",
                input: { command: "true" },
                result: { metadata: { status: "completed" } },
            })
        ).toBeNull();
    });

    it("ignora tools que no son shell y comandos vacíos", () => {
        expect(shellEvidence({ tool: "read", input: { command: "x" }, result: {} })).toBeNull();
        expect(
            shellEvidence({ tool: "shell", input: { command: "   " }, result: { metadata: { exit: 0 } } })
        ).toBeNull();
    });

    it("reconoce los tools que mutan archivos", () => {
        expect(isMutatingTool("edit")).toBe(true);
        expect(isMutatingTool("write")).toBe(true);
        expect(isMutatingTool("patch")).toBe(true);
        expect(isMutatingTool("shell")).toBe(false);
    });
});

describe("isShellMutation: una edición por shell también vence la evidencia", () => {
    it("detecta escrituras por shell", () => {
        for (const cmd of [
            "sed -i 's/a/b/' src/a.ts",
            "cp assets/x.ts .opencode/x.ts",
            "mv a.ts b.ts",
            "rm src/a.ts",
            "echo hi > src/a.ts",
            "cat a | tee b.ts",
            "python -c \"open('a.ts','w')\"",
        ]) {
            expect(isShellMutation(cmd)).toBe(true);
        }
    });

    it("no confunde stderr ni comandos de sólo lectura con mutación", () => {
        for (const cmd of [
            "bun test tests/x.test.ts",
            "bun run test:safe",
            "git status",
            "grep foo src/a.ts 2>/dev/null",
            "cat f 2>&1 | head",
            "tsc --noEmit",
        ]) {
            expect(isShellMutation(cmd)).toBe(false);
        }
    });
});

describe("complete_task: la evidencia se exige de punta a punta", () => {
    const DECL = "bun test tests/a.test.ts";

    function controllerAt(sp: string, extra: any = {}) {
        return new OstackyController({
            statePath: sp,
            initialState: {
                state: "EXECUTING_INLINE",
                changeId: "change-x",
                tasks: {},
                expectedTasks: ["T1"],
                expectedTaskCount: 1,
                taskVerifications: { T1: `test: ${DECL}` },
                audit: [],
                auditSeq: 0,
                ...extra,
            } as any,
        });
    }

    it("sin evidencia rechaza y nombra el comando", async () => {
        const c = controllerAt(statePath());
        const res: any = await c.completeTask({ taskId: "T1" });
        expect(res.verificationFailed).toBe(true);
        expect(res.error).toContain(DECL);
    });

    it("con evidencia verde posterior a la edición completa", async () => {
        const c = controllerAt(statePath(), { shellRuns: [run(DECL, 0, 2_000)], lastMutationTs: 1_000 });
        const res: any = await c.completeTask({ taskId: "T1" });
        expect(res.error).toBeUndefined();
        const tasks: any = await c.getTasks();
        expect(tasks.T1.status).toBe("COMPLETED");
    });

    it("con exit 1 no completa", async () => {
        const c = controllerAt(statePath(), { shellRuns: [run(DECL, 1, 2_000)], lastMutationTs: 1_000 });
        const res: any = await c.completeTask({ taskId: "T1" });
        expect(res.error).toContain("exit 1");
        const tasks: any = await c.getTasks();
        expect(tasks.T1).toBeUndefined();
    });

    it("con corrida anterior a la última edición no completa", async () => {
        const c = controllerAt(statePath(), { shellRuns: [run(DECL, 0, 1_000)], lastMutationTs: 2_000 });
        const res: any = await c.completeTask({ taskId: "T1" });
        expect(res.error).toContain("anterior a la última edición");
    });

    it("el cierre re-verifica: una edición posterior vence la evidencia", async () => {
        const sp = statePath();
        const c = controllerAt(sp, { shellRuns: [run(DECL, 0, 2_000)], lastMutationTs: 1_000 });
        const done: any = await c.completeTask({ taskId: "T1" });
        expect(done.error).toBeUndefined();

        // Simula una edición posterior al complete: la evidencia deja de ser válida.
        const raw = JSON.parse(readFileSync(sp, "utf-8"));
        raw.lastMutationTs = 3_000;
        writeFileSync(sp, JSON.stringify(raw), "utf-8");

        // Producción: el dispatcher del MCP llama reloadFresh() por tool (index.js:3242).
        c.reloadFresh();
        const integrity: any = await c.verifyIntegrity();
        expect(integrity.ok).toBe(false);
        expect(integrity.verificationFailed?.join(" ")).toContain("anterior a la última edición");
    });
});
