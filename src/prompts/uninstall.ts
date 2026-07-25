import * as p from "@clack/prompts";
import { join } from "path";
import type { OpenCodePaths } from "../installer.js";
import {
  uninstallAgent,
  uninstallCommand,
  uninstallSkill,
  uninstallMcpServer,
  uninstallAll,
} from "../installer.js";
import { uninstallEngramConfig } from "../stack.js";
import { readLockfile } from "../lockfile.js";
import { onCancel } from "./helpers.js";

async function doUninstallTotal(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (
    !lockfile ||
    (Object.keys(lockfile.agents).length === 0 &&
      Object.keys(lockfile.commands).length === 0 &&
      Object.keys(lockfile.skills ?? {}).length === 0 &&
      Object.keys(lockfile.mcpServers ?? {}).length === 0)
  ) {
    p.log.info("No hay nada instalado.");
    return;
  }

  const pathsToDelete: string[] = [];
  for (const name of Object.keys(lockfile.agents)) {
    pathsToDelete.push(join(paths.agents, `${name}.md`));
  }
  for (const name of Object.keys(lockfile.commands)) {
    pathsToDelete.push(join(paths.commands, `${name}.md`));
  }
  for (const name of Object.keys(lockfile.skills ?? {})) {
    pathsToDelete.push(join(paths.skills, name));
  }
  for (const name of Object.keys(lockfile.mcpServers ?? {})) {
    pathsToDelete.push(join(paths.mcp, name));
  }

  p.note(
    pathsToDelete.join("\n"),
    `Se eliminarán ${pathsToDelete.length} archivo(s) / directorio(s)`
  );

  const confirm = await p.confirm({
    message: `¿Confirmar desinstalación de ${pathsToDelete.length} item(s)?`,
  });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Desinstalación cancelada.");
    return;
  }

  uninstallAll(paths);
  p.log.success(`${pathsToDelete.length} item(s) eliminado(s).`);

  const cleanEngram = await p.confirm({
    message: "¿Deseas remover la configuración de Engram del proyecto (mcp.engram)?",
  });
  onCancel(cleanEngram);
  if (cleanEngram) {
    const result = uninstallEngramConfig();
    if (result.success) {
      p.log.success(result.message);
    } else {
      p.log.warn(result.message);
    }
  }
}

async function doUninstallAgent(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.agents);
  if (installed.length === 0) {
    p.log.info("No hay agentes instalados.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.agents[name].version}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué agentes querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallAgent(name, paths);
    if (ok) {
      p.log.success(`Agente eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el agente: ${name}`);
    }
  }
}

async function doUninstallCommand(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.commands);
  if (installed.length === 0) {
    p.log.info("No hay commands instalados.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.commands[name].version}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué commands querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallCommand(name, paths);
    if (ok) {
      p.log.success(`Command eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el command: ${name}`);
    }
  }
}

async function doUninstallSkill(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.skills ?? {});
  if (installed.length === 0) {
    p.log.info("No hay skills instaladas.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.skills[name].version}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué skills querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallSkill(name, paths);
    if (ok) {
      p.log.success(`Skill eliminada: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar la skill: ${name}`);
    }
  }
}

async function doUninstallMcp(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.mcpServers ?? {});
  if (installed.length === 0) {
    p.log.info("No hay MCP servers instalados.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.mcpServers?.[name]?.version ?? '?'}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué MCP servers querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallMcpServer(name, paths);
    if (ok) {
      p.log.success(`MCP server eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el MCP server: ${name}`);
    }
  }
}

export async function doUninstall(paths: OpenCodePaths) {
  const scope = await p.select({
    message: "¿Qué querés desinstalar?",
    options: [
      { value: "all", label: "Todo (agentes + commands + skills + MCPs)" },
      { value: "agent", label: "Solo un agente" },
      { value: "command", label: "Solo un command" },
      { value: "skill", label: "Solo una skill" },
      { value: "mcp", label: "Solo un MCP server" },
    ],
  });
  onCancel(scope);

  switch (scope as string) {
    case "all":
      await doUninstallTotal(paths);
      break;
    case "agent":
      await doUninstallAgent(paths);
      break;
    case "command":
      await doUninstallCommand(paths);
      break;
    case "skill":
      await doUninstallSkill(paths);
      break;
    case "mcp":
      await doUninstallMcp(paths);
      break;
  }
}

export async function doUninstallAgentByName(name: string, paths: OpenCodePaths) {
  try {
    const { validateFilePath } = await import("../security.js");
    validateFilePath(`${name}.md`);
  } catch (e) {
    p.log.warn(`Nombre inválido: ${(e as Error).message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !(name in lockfile.agents)) {
    p.log.warn(`${name} no está instalado.`);
    return;
  }
  const filePath = join(paths.agents, `${name}.md`);
  p.note(filePath, `Se eliminará`);
  const confirm = await p.confirm({ message: `¿Borrar ${name}.md?` });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Cancelado.");
    return;
  }
  const ok = uninstallAgent(name, paths);
  if (ok) {
    p.log.success(`Agente eliminado: ${name}`);
  } else {
    p.log.warn(`No se pudo eliminar el agente: ${name}`);
  }
}

export async function doUninstallCommandByName(name: string, paths: OpenCodePaths) {
  try {
    const { validateFilePath } = await import("../security.js");
    validateFilePath(`${name}.md`);
  } catch (e) {
    p.log.warn(`Nombre inválido: ${(e as Error).message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !(name in lockfile.commands)) {
    p.log.warn(`${name} no está instalado.`);
    return;
  }
  const filePath = join(paths.commands, `${name}.md`);
  p.note(filePath, `Se eliminará`);
  const confirm = await p.confirm({ message: `¿Borrar ${name}.md?` });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Cancelado.");
    return;
  }
  const ok = uninstallCommand(name, paths);
  if (ok) {
    p.log.success(`Command eliminado: ${name}`);
  } else {
    p.log.warn(`No se pudo eliminar el command: ${name}`);
  }
}

export async function doUninstallSkillByName(name: string, paths: OpenCodePaths) {
  try {
    const { validateFilePath } = await import("../security.js");
    validateFilePath(name);
  } catch (e) {
    p.log.warn(`Nombre inválido: ${(e as Error).message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !lockfile.skills || !(name in lockfile.skills)) {
    p.log.warn(`${name} no está instalado.`);
    return;
  }
  const dirPath = join(paths.skills, name);
  p.note(dirPath, `Se eliminará`);
  const confirm = await p.confirm({ message: `¿Borrar la skill "${name}"?` });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Cancelado.");
    return;
  }
  const ok = uninstallSkill(name, paths);
  if (ok) {
    p.log.success(`Skill eliminada: ${name}`);
  } else {
    p.log.warn(`No se pudo eliminar la skill: ${name}`);
  }
}

export async function doUninstallMcpByName(name: string, paths: OpenCodePaths) {
  try {
    const { validateFilePath } = await import("../security.js");
    validateFilePath(name);
  } catch (e) {
    p.log.warn(`Nombre inválido: ${(e as Error).message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !lockfile.mcpServers || !(name in lockfile.mcpServers)) {
    p.log.warn(`${name} no está instalado.`);
    return;
  }
  const dirPath = join(paths.mcp, name);
  p.note(dirPath, `Se eliminará`);
  const confirm = await p.confirm({ message: `¿Borrar el MCP server "${name}"?` });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Cancelado.");
    return;
  }
  const ok = uninstallMcpServer(name, paths);
  if (ok) {
    p.log.success(`MCP server eliminado: ${name}`);
  } else {
    p.log.warn(`No se pudo eliminar el MCP server: ${name}`);
  }
}
