#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import {
  runInteractiveMenu,
  runInstallCommand,
  runAddAgentCommand,
  runAddCommandCommand,
  runAddSkillCommand,
  runAddMcpCommand,
  runInstallStackCommand,
  runUninstallStackCommand,
  runUpdateCommand,
  runUninstallCommand,
  runUninstallAgentCommand,
  runUninstallCommandCommand,
  runUninstallSkillCommand,
  runUninstallMcpCommand,
} from "./prompts/index.js";

const HELP = `
ostacky — Instalador de agentes, comandos, skills y MCPs para OpenCode

Uso:
  npx ostacky                    Menú interactivo (instalación completa)
  npx ostacky install            Instalar TODO (agente + skills + MCPs + CodeGraph + OpenSpec + Engram + Context7)
  npx ostacky add agent          Agregar agente(s)
  npx ostacky add command        Agregar command(s)
  npx ostacky add skill          Agregar skill(s)
  npx ostacky add mcp            Agregar MCP server(s)
  npx ostacky install-stack      Instalar solo el stack de herramientas (CodeGraph, OpenSpec, Engram, Context7)
  npx ostacky uninstall-stack    Remover la configuración del stack del proyecto
  npx ostacky update             Actualizar instalación
  npx ostacky uninstall          Desinstalar todo
  npx ostacky uninstall agent    Desinstalar agente(s)
  npx ostacky uninstall command  Desinstalar command(s)
  npx ostacky uninstall skill    Desinstalar skill(s)
  npx ostacky uninstall mcp      Desinstalar MCP server(s)
  npx ostacky --help             Mostrar esta ayuda
  npx ostacky --version          Mostrar versión
`.trim();

const [, , cmd, subcmd] = process.argv;

async function main() {
  switch (cmd) {
    case "install":
      await runInstallCommand();
      break;

    case "install-stack":
      await runInstallStackCommand();
      break;

    case "uninstall-stack":
      await runUninstallStackCommand();
      break;

    case "add":
      if (subcmd === "agent") {
        await runAddAgentCommand();
      } else if (subcmd === "command") {
        await runAddCommandCommand();
      } else if (subcmd === "skill") {
        await runAddSkillCommand();
      } else if (subcmd === "mcp") {
        await runAddMcpCommand();
      } else {
        console.error(`Tipo desconocido: "${subcmd}". Usa 'agent', 'command', 'skill' o 'mcp'.`);
        process.exit(1);
      }
      break;

    case "update":
      await runUpdateCommand();
      break;

    case "uninstall":
      if (subcmd === "agent") {
        const name = process.argv[4];
        await runUninstallAgentCommand(name);
      } else if (subcmd === "command") {
        const name = process.argv[4];
        await runUninstallCommandCommand(name);
      } else if (subcmd === "skill") {
        const name = process.argv[4];
        await runUninstallSkillCommand(name);
      } else if (subcmd === "mcp") {
        const name = process.argv[4];
        await runUninstallMcpCommand(name);
      } else if (subcmd === undefined) {
        await runUninstallCommand();
      } else {
        console.error(
          `Subcomando desconocido: "${subcmd}". Usa 'agent', 'command', 'skill', 'mcp' o nada.`
        );
        process.exit(1);
      }
      break;

    case "--help":
    case "-h":
      console.log(HELP);
      break;

    case "--version":
    case "-v":
      console.log(packageJson.version);
      break;

    default:
      if (cmd) {
        // Comando desconocido — mostrar error, no el menú interactivo
        console.error(`Comando desconocido: "${cmd}". Usá --help para ver los comandos disponibles.`);
        process.exit(1);
      }
      // Sin argumentos → menú interactivo
      await runInteractiveMenu();
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
