import * as p from "@clack/prompts";
import { join } from "path";
import { existsSync } from "fs";
import type { Manifest } from "../github.js";
import {
  installAgent,
  installCommand,
  installSkill,
  installMcpServer,
  type OpenCodePaths,
} from "../installer.js";
import {
  installCodeGraph,
  setupOpenSpec,
  installEngram,
  setupContext7,
} from "../stack.js";
import { ensureToolDirs } from "../fs.js";
import { onCancel } from "./helpers.js";

export async function doInstallStack(toolsDir?: string) {
  const spin = p.spinner();
  let allOk = true;

  // 1. CodeGraph
  spin.start("Instalando CodeGraph...");
  const cg = await installCodeGraph(toolsDir);
  spin.stop(cg.success ? `✓ ${cg.message}` : `✗ ${cg.message}`);
  if (!cg.success) allOk = false;

  // 2. OpenSpec
  spin.start("Configurando OpenSpec...");
  const os = setupOpenSpec();
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
  const cfg = patchOpenCodeConfig();
  spin.stop(cfg.success ? `✓ ${cfg.message}` : `✗ ${cfg.message}`);
  if (!cfg.success) allOk = false;

  if (!allOk) {
    p.log.warn("Algunos componentes requieren atención. Revisá los mensajes de error arriba.");
  }
}

export async function doInstallAll(manifest: Manifest, paths: OpenCodePaths) {
  const spin = p.spinner();
  let errors = 0;

  ensureToolDirs(paths.tools, ["codegraph", "engram", "context7"]);

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

  p.log.info("Instalando stack de herramientas...");
  await doInstallStack(paths.tools);

  const missingTools: string[] = [];
  const codegraphBin = join(paths.tools, "codegraph", "bin", "codegraph");
  const engramBin = join(paths.tools, "engram", "bin", "engram");
  if (!existsSync(codegraphBin)) missingTools.push("CodeGraph");
  if (!existsSync(engramBin)) missingTools.push("Engram");

  if (missingTools.length > 0) {
    p.log.warn(
      `Faltan herramientas del stack: ${missingTools.join(", ")}.\n` +
      "Ejecutá `/install-stack` desde el agente para instalarlas manualmente."
    );
  }

  if (errors === 0) {
    p.log.success("Todo instalado correctamente.");
  } else {
    p.log.warn(`Completado con ${errors} error(es).`);
  }
}
