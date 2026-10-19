import { describe, expect, it } from "bun:test";
import { shellReadTargets, isCodePath } from "../assets/plugins/ostacky-controller/index.ts";

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
});
