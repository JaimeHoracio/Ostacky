import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTreeHash } from "../src/fs.js";
import { sha256 } from "../src/security.js";
import { mcpArtifactHash } from "../src/installer.js";

const projectRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf-8")) as {
  agents: Array<{ name: string; sha256: string }>;
  mcpServers: Array<{ name: string; sha256: string; sourceSha256?: string }>;
};

describe("manifest asset hashes", () => {
  it("only declares MCP servers that are bundled in assets", () => {
    for (const server of manifest.mcpServers) {
      expect(existsSync(join(projectRoot, "assets", "mcp", server.name))).toBe(true);
    }
  });

  it("matches the bundled Ostacky agent source", () => {
    const agent = manifest.agents.find((item) => item.name === "ostacky");
    expect(agent?.sha256).toBe(
      sha256(readFileSync(join(projectRoot, "assets", "agents", "ostacky.md"), "utf-8"))
    );
  });

  it("matches the bundled controller source tree", () => {
    const controller = manifest.mcpServers.find((item) => item.name === "ostacky-controller");
    // sourceSha256 trackea el source; sha256 es el hash del bundle (artefacto
    // instalable) y sólo existe como tal cuando dist/mcp fue construido.
    expect(controller?.sourceSha256).toBe(
      computeTreeHash(join(projectRoot, "assets", "mcp", "ostacky-controller"))
    );
  });

  it("usa el hash del bundle como sha256 cuando dist/mcp existe", () => {
    const bundlePath = join(projectRoot, "dist", "mcp", "ostacky-controller", "index.js");
    if (!existsSync(bundlePath)) return;
    const controller = manifest.mcpServers.find((item) => item.name === "ostacky-controller");
    expect(controller?.sha256).toBe(sha256(readFileSync(bundlePath, "utf-8")));
  });
});

/**
 * Regresión: `doctor` comparaba `sha256` (hash del bundle, lo que el installer
 * copia) contra el tree hash del SOURCE. Son dominios distintos, así que el ❌
 * era permanente aunque `hash:check` pasara. La clave válida depende del
 * artefacto: bundle → `sha256`; fallback dev → `sourceSha256`.
 */
describe("mcpArtifactHash", () => {
  it("con bundle valida sha256 del artefacto", () => {
    const root = mkdtempSync(join(tmpdir(), "ostacky-artifact-"));
    try {
      mkdirSync(join(root, "dist", "mcp", "x"), { recursive: true });
      writeFileSync(join(root, "dist", "mcp", "x", "index.js"), "console.log(1)\n", "utf-8");
      const { field, actual } = mcpArtifactHash("x", root);
      expect(field).toBe("sha256");
      expect(actual).toBe(sha256("console.log(1)\n"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sin bundle cae al tree hash del source", () => {
    const root = mkdtempSync(join(tmpdir(), "ostacky-artifact-"));
    try {
      mkdirSync(join(root, "assets", "mcp", "x"), { recursive: true });
      writeFileSync(join(root, "assets", "mcp", "x", "index.js"), "x\n", "utf-8");
      const { field, actual } = mcpArtifactHash("x", root);
      expect(field).toBe("sourceSha256");
      expect(actual).toBe(computeTreeHash(join(root, "assets", "mcp", "x")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("en este repo la clave es sha256 y coincide con el manifest", () => {
    const bundlePath = join(projectRoot, "dist", "mcp", "ostacky-controller", "index.js");
    if (!existsSync(bundlePath)) return;
    const { field, actual } = mcpArtifactHash("ostacky-controller");
    const controller = manifest.mcpServers.find((item) => item.name === "ostacky-controller");
    expect(field).toBe("sha256");
    expect(actual).toBe(controller?.sha256);
    // Los dominios no son intercambiables: comparar sha256 contra el tree hash
    // del source (el bug) falla siempre.
    expect(actual).not.toBe(computeTreeHash(join(projectRoot, "assets", "mcp", "ostacky-controller")));
  });
});
