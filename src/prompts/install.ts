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
  setupContext7,
} from "../stack.js";
import { ensureToolDirs, findBinaryInDir } from "../fs.js";
import { onCancel, isGlobalScope } from "./helpers.js";

export async function doInstallStack(toolsDir?: string, projectRoot?: string): Promise<boolean> {
  const spin = p.spinner();
  let allOk = true;
  const resolvedProjectRoot = projectRoot ?? dirname(dirname(toolsDir ?? join(process.cwd(), ".opencode", "tools")));

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

  // 3. Engram
  spin.start("Instalando Engram...");
  const eng = await installEngram(toolsDir);
  spin.stop(eng.success ? `✓ ${eng.message}` : `✗ ${eng.message}`);
  if (!eng.success) allOk = false;

  // 4. Context7
  spin.start("Configurando Context7...");
  const ctx = setupContext7(toolsDir);
  spin.stop(ctx.success ? `✓ ${ctx.message}` : `✗ ${ctx.message}`);
  if (!ctx.success) allOk = false;

  // 5. Config
  spin.start("Verificando configuración...");
  const { patchOpenCodeConfig } = await import("../config.js");
  const cfg = patchOpenCodeConfig(resolvedProjectRoot);
  spin.stop(cfg.success ? `✓ ${cfg.message}` : `✗ ${cfg.message}`);
  if (!cfg.success) allOk = false;

  if (!allOk) {
    p.log.warn("Algunos componentes requieren atención. Revisá los mensajes de error arriba.");
  }
  return allOk;
}

export async function doInstallAll(manifest: Manifest, paths: OpenCodePaths): Promise<boolean> {
  const spin = p.spinner();
  let errors = 0;

  // Scope global: tools siempre local, no crear tools globales. Saltar stack global.
  const isGlobal = isGlobalScope(paths);
  if (!isGlobal) {
    ensureToolDirs(paths.tools, ["codegraph", "engram", "context7"]);
  } else {
    p.log.info("Scope global detectado: el stack (CodeGraph/Engram) permanece siempre en <proyecto>/.opencode/tools — se omite instalación de stack global.");
    p.log.info("Para instalar el stack, ejecutá 'npx ostacky install-stack --scope local' dentro de cada proyecto.");
  }

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

  let stackOk = true;
  let missingTools: string[] = [];
  if (isGlobal) {
    // En global no instalamos stack — se deja para install local por proyecto
    stackOk = true;
  } else {
    p.log.info("Instalando stack de herramientas...");
    stackOk = await doInstallStack(paths.tools, dirname(paths.root));
    if (!stackOk) errors++;

    const codegraphDir = join(paths.tools, "codegraph");
    const engramDir = join(paths.tools, "engram");
    if (!existsSync(codegraphDir) || !findBinaryInDir(codegraphDir, "codegraph")) missingTools.push("CodeGraph");
    if (!existsSync(engramDir) || !findBinaryInDir(engramDir, "engram")) missingTools.push("Engram");
  }

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

  return errors === 0 && stackOk && missingTools.length === 0;
}
