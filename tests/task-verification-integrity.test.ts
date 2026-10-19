import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OstackyController, parseTaskVerifications } from "../assets/mcp/ostacky-controller/index.js";

const TMP_PREFIX = join(tmpdir(), "ostacky-task-verif-");
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

function writeTasks(changeId: string, body: string): void {
    const dir = join(tmp, "openspec", "changes", changeId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tasks.md"), body, "utf-8");
}

function snapshot(overrides: any = {}) {
    return {
        recommendation: "INLINE",
        reasons: ["cluster único"],
        codegraphUsed: ["codegraph_codegraph_explore"],
        taskCount: 1,
        expectedTaskIds: ["T1"],
        sharedFiles: {},
        fileClusters: [["T1"]],
        clusterCount: 1,
        sequentialDeps: [],
        estLines: 10,
        hasExplicitContract: false,
        filesPerTask: { T1: ["src/a.ts"] },
        globalRuleTriggered: "3a",
        reasoning: { files: ["src/a.ts"], estLines: 10 },
        ...overrides,
    };
}

describe("task-verification-integrity", () => {
    it("carga taskVerifications desde tasks.md sin tool manual", async () => {
        writeTasks("change-x", "## 1\n\n- [ ] T1 tocar a — verificar: file:src/a.ts contiene foo\n");
        mkdirSync(join(tmp, "src"), { recursive: true });
        writeFileSync(join(tmp, "src", "a.ts"), "bar", "utf-8");

        const sp = statePath();
        const c = new OstackyController({
            statePath: sp,
            initialState: { state: "EXECUTION_ANALYSIS", changeId: "change-x", degraded: false, audit: [], auditSeq: 0 } as any,
        });
        const res: any = await c.recordExecutionAnalysis({ executionDecisionId: "e1", snapshot: snapshot() as any });
        expect(res.error).toBeUndefined();

        const raw = JSON.parse(readFileSync(sp, "utf-8"));
        expect(raw.taskVerifications?.T1).toContain("file:src/a.ts contiene foo");
    });

    it("parsea el marker real aunque la descripción mencione el formato", () => {
        writeTasks("change-z", "## 1\n\n- [ ] T1 documentar el formato «— verificar: file:x» — verificar: file:src/a.ts contiene foo\n");
        const verifs = parseTaskVerifications("change-z", join(tmp, ".opencode", "ostacky-state.json"));
        expect(verifs.T1).toBe("file:src/a.ts contiene foo");
    });

    it("filePath inexistente se rechaza y no marca COMPLETED", async () => {
        const c = new OstackyController({
            statePath: statePath(),
            initialState: { state: "EXECUTING_INLINE", tasks: {}, expectedTasks: ["T1"], expectedTaskCount: 1, audit: [], auditSeq: 0 } as any,
        });
        const res: any = await c.completeTask({ taskId: "T1", filePath: "src/no-existe.ts" });
        expect(res.error).toContain("filePath does not exist");

        const tasks: any = await c.getTasks();
        expect(tasks.T1).toBeUndefined();
    });

    it("filePath existente sigue funcionando (no over-blocking)", async () => {
        mkdirSync(join(tmp, "src"), { recursive: true });
        writeFileSync(join(tmp, "src", "a.ts"), "contenido", "utf-8");
        const c = new OstackyController({
            statePath: statePath(),
            initialState: { state: "EXECUTING_INLINE", tasks: {}, expectedTasks: ["T1"], expectedTaskCount: 1, audit: [], auditSeq: 0 } as any,
        });
        const res: any = await c.completeTask({ taskId: "T1", filePath: "src/a.ts" });
        expect(res.error).toBeUndefined();
        const tasks: any = await c.getTasks();
        expect(tasks.T1.status).toBe("COMPLETED");
    });

    it("task COMPLETED con filePath y sin hash es stale", async () => {
        mkdirSync(join(tmp, "src"), { recursive: true });
        writeFileSync(join(tmp, "src", "a.ts"), "contenido", "utf-8");
        const c = new OstackyController({
            statePath: statePath(),
            initialState: {
                state: "EXECUTING_INLINE",
                tasks: { T1: { status: "COMPLETED", filePath: "src/a.ts", fileHash: null } },
                expectedTasks: ["T1"],
                expectedTaskCount: 1,
                audit: [],
                auditSeq: 0,
            } as any,
        });
        const res: any = await c.verifyIntegrity();
        expect(res.ok).toBe(false);
        expect(res.staleFiles.join(" ")).toContain("missing hash");
    });

    it("force exige la frase del usuario, no la del agente", async () => {
        const base = {
            state: "EXECUTING_INLINE",
            tasks: { T1: { status: "COMPLETED" } },
            expectedTasks: ["T1", "T2"],
            expectedTaskCount: 2,
            auditSeq: 1,
        };
        // La frase en el audit (lo que escribía el agente) ya NO abre el gate.
        const c1 = new OstackyController({
            statePath: statePath("s1.json"),
            initialState: { ...base, audit: [{ reasoning: "confirmo forzar" }], lastUserPrompts: [] } as any,
        });
        const blocked: any = await c1.implementationComplete({ force: true });
        expect(blocked.error).toContain("force requires human confirmation");

        // La frase en un prompt real del usuario (lo que registra el plugin) sí lo abre.
        const c2 = new OstackyController({
            statePath: statePath("s2.json"),
            initialState: { ...base, audit: [], lastUserPrompts: ["dale, confirmo forzar el cierre"] } as any,
        });
        const allowed: any = await c2.implementationComplete({ force: true });
        expect(allowed.state).toBe("SYNC");
    });

    it("gate vacío deriva de tasks.md y bloquea", async () => {
        writeTasks("change-y", "## 1\n\n- [ ] T1 uno\n- [ ] T2 dos\n");
        const c = new OstackyController({
            statePath: statePath(),
            initialState: { state: "EXECUTING_INLINE", changeId: "change-y", tasks: {}, audit: [], auditSeq: 0 } as any,
        });
        const integrity: any = await c.verifyIntegrity();
        expect(integrity.ok).toBe(false);
        expect(integrity.pending.length).toBe(2);

        const blocked: any = await c.implementationComplete({});
        expect(blocked.error).toContain("tasks incomplete");
    });
});
