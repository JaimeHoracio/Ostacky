import * as p from "@clack/prompts";
import { dirname } from "path";
import { ensureToolDirs } from "../fs.js";
import { loadManifest, loadLatestManifest, printPostInstallSteps, resolveOpenCodePaths, onCancel } from "./helpers.js";
import { doInstallAll, doInstallStack } from "./install.js";
import { doAddAgent, doAddCommand, doAddSkill, doAddMcp } from "./add.js";
import { doUpdate } from "./update.js";
import { doUninstall, doUninstallAgentByName, doUninstallCommandByName, doUninstallSkillByName, doUninstallMcpByName } from "./uninstall.js";

export { printPostInstallSteps } from "./helpers.js";

export async function runInteractiveMenu() {
  p.intro(" OpenCode Installer ");

  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();

  if (!paths) {
    p.outro("Instalación cancelada.");
    return;
  }

  const action = await p.select({
    message: "¿Qué deseas hacer?",
    options: [
      { value: "all", label: "Instalar todo" },
      { value: "agent", label: "Instalar agente" },
      { value: "command", label: "Instalar command" },
      { value: "skill", label: "Instalar skill" },
      { value: "mcp", label: "Instalar MCP server" },
      { value: "stack", label: "Instalar stack de herramientas (CodeGraph, Engram, Context7)" },
      { value: "update", label: "Actualizar instalación" },
      { value: "uninstall", label: "Desinstalar" },
      { value: "exit", label: "Salir" },
    ],
  });
  onCancel(action);

  switch (action as string) {
    case "all":
      if (!(await doInstallAll(manifest, paths))) process.exitCode = 1;
      printPostInstallSteps();
      p.outro(process.exitCode ? "Instalación parcial." : "Listo.");
      break;
    case "agent":
      await doAddAgent(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "command":
      await doAddCommand(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "skill":
      await doAddSkill(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "mcp":
      await doAddMcp(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "stack": {
      ensureToolDirs(paths.tools, ["codegraph", "engram", "context7"]);
      const stackOk = await doInstallStack(paths.tools, dirname(paths.root));
      if (!stackOk) process.exitCode = 1;
      p.outro(stackOk ? "Listo." : "Instalación parcial.");
      break;
    }
    case "update": {
      const latestManifest = await loadLatestManifest();
      await doUpdate(latestManifest, paths);
      p.outro("Listo.");
      break;
    }
    case "uninstall":
      await doUninstall(paths);
      p.outro("Listo.");
      break;
    case "exit":
      p.outro("Hasta luego.");
      break;
  }
}

export async function runInstallCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  if (!(await doInstallAll(manifest, paths))) process.exitCode = 1;
  printPostInstallSteps();
  p.outro(process.exitCode ? "Instalación parcial." : "Instalación completada.");
}

export async function runAddAgentCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddAgent(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runAddCommandCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddCommand(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runAddSkillCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddSkill(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runAddMcpCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddMcp(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runInstallStackCommand() {
  p.intro(" OpenCode Installer — Stack ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  ensureToolDirs(paths.tools, ["codegraph", "engram", "context7"]);
  const stackOk = await doInstallStack(paths.tools, dirname(paths.root));
  if (!stackOk) process.exitCode = 1;
  p.outro(stackOk ? "Stack instalado." : "Stack instalado parcialmente.");
}

export async function runUninstallStackCommand() {
  p.intro(" OpenCode Installer — Stack ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }

  const confirm = await p.confirm({
    message: "¿Remover la configuración del stack (CodeGraph, Engram, Context7) del proyecto? Los binarios globales no se tocan.",
  });
  onCancel(confirm);
  if (!confirm) {
    p.outro("Cancelado.");
    return;
  }

  const { uninstallStackConfig } = await import("../stack.js");
  const result = uninstallStackConfig(paths);
  if (result.success) {
    p.log.success(result.message);
  } else {
    p.log.warn(result.message);
  }

  p.outro("Stack desinstalado.");
}

export async function runUpdateCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadLatestManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doUpdate(manifest, paths);
  p.outro("Actualización completada.");
}

export async function runUninstallCommand() {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doUninstall(paths);
  p.outro("Desinstalación completada.");
}

export async function runUninstallAgentCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  if (name) {
    await doUninstallAgentByName(name, paths);
  } else {
    const { readLockfile } = await import("../lockfile.js");
    const lockfile = readLockfile(paths.root);
    if (lockfile && Object.keys(lockfile.agents).length > 0) {
      const prompts = p;
      // Inline agent selection for single name
      const installed = Object.keys(lockfile.agents);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.agents[n].version}`,
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué agentes querés desinstalar?",
        options,
        required: true,
      });
      onCancel(selected);
      for (const n of selected as string[]) {
        await doUninstallAgentByName(n, paths);
      }
    } else {
      p.log.info("No hay agentes instalados.");
    }
  }
  p.outro("Listo.");
}

export async function runUninstallCommandCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  if (name) {
    await doUninstallCommandByName(name, paths);
  } else {
    const { readLockfile } = await import("../lockfile.js");
    const lockfile = readLockfile(paths.root);
    if (lockfile && Object.keys(lockfile.commands).length > 0) {
      const prompts = p;
      const installed = Object.keys(lockfile.commands);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.commands[n].version}`,
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué commands querés desinstalar?",
        options,
        required: true,
      });
      onCancel(selected);
      for (const n of selected as string[]) {
        await doUninstallCommandByName(n, paths);
      }
    } else {
      p.log.info("No hay commands instalados.");
    }
  }
  p.outro("Listo.");
}

export async function runUninstallSkillCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  if (name) {
    await doUninstallSkillByName(name, paths);
  } else {
    const { readLockfile } = await import("../lockfile.js");
    const lockfile = readLockfile(paths.root);
    if (lockfile && lockfile.skills && Object.keys(lockfile.skills).length > 0) {
      const prompts = p;
      const installed = Object.keys(lockfile.skills);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.skills[n].version}`,
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué skills querés desinstalar?",
        options,
        required: true,
      });
      onCancel(selected);
      for (const n of selected as string[]) {
        await doUninstallSkillByName(n, paths);
      }
    } else {
      p.log.info("No hay skills instaladas.");
    }
  }
  p.outro("Listo.");
}

export async function runUninstallMcpCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  if (name) {
    await doUninstallMcpByName(name, paths);
  } else {
    const { readLockfile } = await import("../lockfile.js");
    const lockfile = readLockfile(paths.root);
    if (lockfile && lockfile.mcpServers && Object.keys(lockfile.mcpServers).length > 0) {
      const prompts = p;
      const installed = Object.keys(lockfile.mcpServers);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.mcpServers?.[n]?.version ?? '?'}`,
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué MCP servers querés desinstalar?",
        options,
        required: true,
      });
      onCancel(selected);
      for (const n of selected as string[]) {
        await doUninstallMcpByName(n, paths);
      }
    } else {
      p.log.info("No hay MCP servers instalados.");
    }
  }
  p.outro("Listo.");
}
