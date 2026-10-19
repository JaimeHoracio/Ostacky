import { describe, expect, it } from "bun:test";
import { shellReadTargets, isCodePath, isShellPathExempt, testVerifyCommands } from "../assets/plugins/ostacky-controller/index.ts";

describe("shell-code-read-gate: el gate distingue 'revela' de 'menciona'", () => {
    it("detecta lecturas de código por shell", () => {
        for (const cmd of [
            "cat src/auth.ts",
            "sed -n '1,20p' src/auth.ts",
            "grep foo src/auth.ts",
            "head -50 assets/plugins/ostacky-controller/index.ts",
            "cat src/a.ts | head",
            "sudo cat src/a.ts",
            "/bin/cat src/a.ts",
        ]) {
            expect(shellReadTargets(cmd).length).toBeGreaterThan(0);
        }
    });

    it("NO bloquea comandos de trabajo que sólo mencionan código", () => {
        for (const cmd of [
            "bun test tests/x.test.ts",
            "bun run build",
            "git status",
            "git diff",
            "npm install",
            "tsc src/a.ts",
        ]) {
            expect(shellReadTargets(cmd)).toEqual([]);
        }
    });

    it("NO bloquea diff que sólo compara metadatos (-q/--stat)", () => {
        for (const cmd of ["diff -q src/a.ts src/b.ts", "diff --stat src/a.ts src/b.ts", "diff -rq src/ lib/"]) {
            expect(shellReadTargets(cmd)).toEqual([]);
        }
        // diff normal SÍ revela contenido.
        expect(shellReadTargets("diff src/a.ts src/b.ts").length).toBeGreaterThan(0);
    });

    it("NO bloquea escrituras (redirección o sed -i)", () => {
        for (const cmd of [
            "sed -i 's/a/b/' src/a.ts",
            "cat > src/new.ts",
            "cat >> src/a.ts",
        ]) {
            expect(shellReadTargets(cmd)).toEqual([]);
        }
    });

    it("NO bloquea docs/json/openspec", () => {
        for (const cmd of [
            "cat package.json",
            "cat README.md",
            "cat openspec/changes/x/tasks.md",
            "cat assets/docs/ostacky-reference.md",
        ]) {
            expect(shellReadTargets(cmd)).toEqual([]);
        }
    });

    it("devuelve el path real, no el comando ni el flag", () => {
        expect(shellReadTargets("cat src/auth.ts")).toEqual(["src/auth.ts"]);
        expect(shellReadTargets("sed -n '1,20p' src/auth.ts")).toEqual(["src/auth.ts"]);
    });

    it("fail-open: verbo fuera de la allowlist no bloquea", () => {
        expect(shellReadTargets("mytool src/auth.ts")).toEqual([]);
        // Bypass residual documentado en el spec, no accidental.
        expect(shellReadTargets("python -c \"open('src/a.ts').read()\"")).toEqual([]);
    });

    it("isCodePath: código sí, docs/json no", () => {
        expect(isCodePath("src/a.ts")).toBe(true);
        expect(isCodePath("assets/plugins/ostacky-controller/index.ts")).toBe(true);
        expect(isCodePath("README.md")).toBe(false);
        expect(isCodePath("package.json")).toBe(false);
        expect(isCodePath("assets/docs/ostacky-reference.md")).toBe(false);
    });

    // review fix-v2-checkpointer M1: los redirects de stderr NO son escritura.
    // Antes el check per-segmento `>` los trataba como escritura y
    // `cat src/x.ts 2>&1` (el bypass casual más probable) se colaba del gate.
    it("redirects de stderr no colan la lectura del gate", () => {
        for (const cmd of ["cat src/a.ts 2>&1", "head -5 src/cli.ts 2>&1 | grep -n import", "sed -n '1,20p' src/x.ts 2>&1"]) {
            expect(shellReadTargets(cmd).length).toBeGreaterThan(0);
        }
    });

    // review fix-v2-checkpointer M3: paths FUERA del proyecto quedan exentos.
    // `cat /tmp/.../*.ts` (fixtures temporales de tests) no puede bloquear:
    // no son código de este codebase y un BLOCK rompe pipelines sin escape hatch.
    it("isShellPathExempt: fuera del proyecto sí, código del proyecto no", () => {
        const root = "/home/dev/proj";
        expect(isShellPathExempt("/tmp/opencode/out.ts", root, null)).toBe(true);
        expect(isShellPathExempt("/var/log/report.ts", root, null)).toBe(true);
        expect(isShellPathExempt("src/a.ts", root, null)).toBe(false);
        expect(isShellPathExempt("/home/dev/proj/src/a.ts", root, null)).toBe(false);
        // dentro del proyecto: specs/docs exentos, path trackeado exento vía freshState
        expect(isShellPathExempt("openspec/changes/x/tasks.md", root, null)).toBe(true);
        expect(isShellPathExempt("src/trackeado.ts", root, { fileFingerprints: { "src/trackeado.ts": "h" } })).toBe(true);
    });

    // review fix-v2-checkpointer M2: sólo comandos `test:` declarados son evidencia.
    it("testVerifyCommands: extrae el comando exacto de cada verificación test:", () => {
        const state = {
            taskVerifications: {
                T1: "test: bun test tests/a.test.ts",
                T2: "file:src/a.ts contiene foo",
                T3: "test: bun test tests/domains/settle.test.ts",
            },
        };
        expect(testVerifyCommands(state)).toEqual(
            new Set(["bun test tests/a.test.ts", "bun test tests/domains/settle.test.ts"])
        );
        expect(testVerifyCommands(null).size).toBe(0);
    });
});
