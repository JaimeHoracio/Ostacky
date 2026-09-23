import * as p from "@clack/prompts";
import { dirname, join } from "path";
import { existsSync } from "fs";
import type { Manifest } from "../github.js";
import {
  installAgent,
  installCommand,
  installSkill,
  installMcpServer,
  pruneStaleSkills,
  type OpenCodePaths,
} from "../installer.js";
import {
  installCodeGraph,
  setupOpenSpec,
  installEngram,
} from "../stack.js";
import { ensureToolDirs, findBinaryInDir, ensureGitignore } from "../fs.js";
import { onCancel } from "./helpers.js";

export async function doInstallStack(toolsDir?: string, projectRoot?: string): Promise<boolean> {
  const spin = p.spinner();
  let allOk = true;
  const resolvedProjectRoot = projectRoot ?? dirname(dirname(toolsDir ?? join(process.cwd(), ".opencode", "tools")));
  const resolvedToolsDir = toolsDir ?? join(resolvedProjectRoot, ".opencode", "tools");
  p.log.info(`Stack → projectRoot: ${resolvedProjectRoot} | toolsDir: ${resolvedToolsDir}`);
  // Advertencia si parece instalación en home sin proyecto (confusión local vs global)
  try {
    const { homedir } = await import("os");
    const home = homedir();
    const inHome = resolvedProjectRoot.replace(/\\/g, "/") === home.replace(/\\/g, "/");
    if (inHome && !existsSync(join(home, ".git"))) {
      p.log.warn(`Estás instalando el stack en tu home (${home}). Si esperabas instalar en un proyecto, hacé cd al proyecto y usá --scope local.`);
    }
  } catch {}

  // 1. CodeGraph
  spin.start("Instalando CodeGraph...");
  const cg = await installCodeGraph(toolsDir);
  spin.stop(cg.success ? `✓ ${cg.message}` : `✗ ${cg.message}`);
  if (!cg.success) allOk = false;

  // 2. OpenSpec
  spin.start("Configurando OpenSpec...");
  const os = setupOpenSpec(resolvedProjectRoot);
  spin.stop(os.success ? `✓ ${os.message}` : `✗ ${os.message}`);
  if (!os.success) allOk = false;

  // 3. Engram (+ OstackyController plugin)
  spin.start("Instalando Engram...");
  const eng = await installEngram(toolsDir);
  spin.stop(eng.success ? `✓ ${eng.message}` : `✗ ${eng.message}`);
  if (!eng.success) allOk = false;

  // 4. Config (incluye plugin controller)
  spin.start("Verificando configuración...");
  const { patchOpenCodeConfig } = await import("../config.js");
  const cfg = patchOpenCodeConfig(resolvedProjectRoot);
  spin.stop(cfg.success ? `✓ ${cfg.message}` : `✗ ${cfg.message}`);
  if (!cfg.success) allOk = false;

  if (!allOk) {
    p.log.warn("Algunos componentes requieren atención. Revisá los mensajes de error arriba.");
  }
  // Automatizar .gitignore (no fatal, siempre local)
  try {
    const gi = ensureGitignore(resolvedProjectRoot);
    if (gi.created) p.log.info(`.gitignore creado con patrones Ostacky`);
    else if (gi.updated) p.log.info(`.gitignore actualizado: ${gi.patternsAdded.join(", ")}`);
  } catch {}
  return allOk;
}

export async function doInstallAll(manifest: Manifest, paths: OpenCodePaths): Promise<boolean> {
  const spin = p.spinner();
  let errors = 0;

  p.log.info(`Scope → local | opencodeDir: ${paths.root} | tools: ${paths.tools}`);
  ensureToolDirs(paths.tools, ["codegraph", "engram"]);

  for (const agent of manifest.agents) {
    spin.start(`Descargando agente: ${agent.name}  (${agent.version})`);
    try {
      await installAgent(agent, manifest, paths);
      spin.stop(`Agente instalado: ${agent.name}  (${agent.version})`);
    } catch (e) {
      spin.stop(`Error en ${agent.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  for (const cmd of manifest.commands) {
    spin.start(`Descargando command: ${cmd.name}  (${cmd.version})`);
    try {
      await installCommand(cmd, manifest, paths);
      spin.stop(`Command instalado: ${cmd.name}  (${cmd.version})`);
    } catch (e) {
      spin.stop(`Error en ${cmd.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  for (const skill of manifest.skills ?? []) {
    spin.start(`Instalando skill: ${skill.name}  (${skill.version})`);
    try {
      await installSkill(skill, manifest, paths);
      spin.stop(`Skill instalada: ${skill.name}  (${skill.version})`);
    } catch (e) {
      spin.stop(`Error en ${skill.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  // B3: prune skills obsoletas que quedaron de instalaciones previas
  const pruned = pruneStaleSkills(paths, manifest);
  if (pruned.length > 0) {
    p.log.info(`Skills obsoletas removidas: ${pruned.join(", ")}`);
  }

  for (const mcp of manifest.mcpServers ?? []) {
    spin.start(`Instalando MCP server: ${mcp.name}  (${mcp.version})`);
    try {
      await installMcpServer(mcp, manifest, paths);
      spin.stop(`MCP server instalado: ${mcp.name}  (${mcp.version})`);
    } catch (e) {
      spin.stop(`Error en ${mcp.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  // Plugins: package dir ostacky-controller/ + engram.ts (formato V2 — cada
  // .ts suelto se carga como plugin independiente, los helpers no van sueltos)
  try {
    const { copyFileSync, mkdirSync, existsSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { PACKAGE_ROOT } = await import("../github.js");
    const { findProjectRoot } = await import("../fs.js");
    const packageSrc = join(PACKAGE_ROOT, "assets", "plugins", "ostacky-controller");
    const packageDest = join(paths.plugins, "ostacky-controller");
    if (existsSync(join(packageSrc, "index.ts"))) {
      mkdirSync(packageDest, { recursive: true });
      for (const f of ["index.ts", "controller-core.ts", "security.ts", "tiered.ts"]) {
        const s = join(packageSrc, f);
        if (existsSync(s)) copyFileSync(s, join(packageDest, f));
      }
    }
    // Cleanup legacy: sueltos que el server carga como plugins y fallan (sin default),
    // más guard/controller viejos de instalaciones previas
    for (const legacy of ["ostacky-plugin.ts", "controller-core.ts", "security.ts", "tiered.ts", "ostacky-guard.ts", "ostacky-controller.ts"]) {
      const lp = join(paths.plugins, legacy);
      if (existsSync(lp)) try { rmSync(lp, { force: true }); } catch {}
    }
    const srcEng = join(PACKAGE_ROOT, "assets", "plugins", "engram.ts");
    const destEng = join(paths.plugins, "engram.ts");
    if (existsSync(srcEng)) {
      mkdirSync(paths.plugins, { recursive: true });
      copyFileSync(srcEng, destEng);
    }
  } catch {}

  let stackOk = true;
  let missingTools: string[] = [];
  p.log.info("Instalando stack de herramientas...");
  stackOk = await doInstallStack(paths.tools, dirname(paths.root));
  if (!stackOk) errors++;

  const codegraphDir = join(paths.tools, "codegraph");
  const engramDir = join(paths.tools, "engram");
  if (!existsSync(codegraphDir) || !findBinaryInDir(codegraphDir, "codegraph")) missingTools.push("CodeGraph");
  if (!existsSync(engramDir) || !findBinaryInDir(engramDir, "engram")) missingTools.push("Engram");

  if (missingTools.length > 0) {
    p.log.warn(
      `Faltan herramientas del stack: ${missingTools.join(", ")}.\n` +
      "Ejecutá `/install-stack` desde el agente para instalarlas manualmente."
    );
  }

  if (errors === 0 && stackOk && missingTools.length === 0) {
    p.log.success("Todo instalado correctamente.");
  } else {
    p.log.warn(`Instalación parcial: ${errors} componente(s) requieren atención.`);
  }

  // Automatizar .gitignore (no fatal)
  try {
    const projectRoot = dirname(paths.root);
    const gi = ensureGitignore(projectRoot);
    if (gi.created) p.log.info(`.gitignore creado con patrones Ostacky`);
    else if (gi.updated) p.log.info(`.gitignore actualizado: ${gi.patternsAdded.join(", ")}`);
  } catch {}

  return errors === 0 && stackOk && missingTools.length === 0;
}
