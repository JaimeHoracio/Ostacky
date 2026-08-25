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
  npx ostacky [--scope local|global|auto]                    Menú interactivo (instalación completa, pregunta local vs global, default local)
  npx ostacky install [--scope local|global|auto]            Instalar TODO (agente + skills + MCPs + CodeGraph + OpenSpec + Engram + Context7)
  npx ostacky add agent [--scope local|global|auto]          Agregar agente(s)
  npx ostacky add command [--scope ...]        Agregar command(s)
  npx ostacky add skill [--scope ...]          Agregar skill(s)
  npx ostacky add mcp [--scope ...]            Agregar MCP server(s)
  npx ostacky install-stack [--scope local|auto]      Instalar solo el stack de herramientas (CodeGraph, OpenSpec, Engram, Context7) — global bloquea con error
  npx ostacky uninstall-stack [--scope local|global|auto]    Remover la configuración del stack del proyecto
  npx ostacky update [--scope ...]             Actualizar instalación
  npx ostacky uninstall [--scope ...]          Desinstalar todo
  npx ostacky uninstall agent [--scope ...]    Desinstalar agente(s)
  npx ostacky uninstall command [--scope ...]  Desinstalar command(s)
  npx ostacky uninstall skill [--scope ...]    Desinstalar skill(s)
  npx ostacky uninstall mcp [--scope ...]      Desinstalar MCP server(s)
  npx ostacky --help             Mostrar esta ayuda
  npx ostacky --version          Mostrar versión

Scope:
  --scope local   Escribe en <proyecto>/.opencode (recomendado, default al preguntar)
  --scope global  Escribe en ~/.config/opencode (o %APPDATA%\\opencode en Windows)
  --scope auto    Elige local si existe .opencode o .git, si no global
  Sin flag        Pregunta interactiva local (default) vs global
`.trim();

function parseScopeArg(argv: string[] = process.argv): "local" | "global" | "auto" | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope" && i + 1 < argv.length) {
      const v = argv[i + 1];
      if (v === "local" || v === "global" || v === "auto") return v;
    }
    if (arg.startsWith("--scope=")) {
      const v = arg.split("=")[1];
      if (v === "local" || v === "global" || v === "auto") return v as "local" | "global" | "auto";
    }
  }
  return null;
}
function withoutScopeArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope" && i + 1 < argv.length) { i++; continue; }
    if (arg.startsWith("--scope=")) continue;
    out.push(arg);
  }
  return out;
}
const scope = parseScopeArg();
const argvNoScope = withoutScopeArgs(process.argv);
const [, , cmd, subcmd] = argvNoScope;

async function main() {
  switch (cmd) {
    case "install":
      await runInstallCommand(scope);
      break;

    case "install-stack":
      if (scope === "global") {
        console.error("Error: install-stack requiere scope local; el stack vive en <proyecto>/.opencode/tools");
        console.error("Sugerencia: ejecutá 'npx ostacky install-stack --scope local' dentro de cada proyecto.");
        process.exit(1);
      }
      await runInstallStackCommand(scope);
      break;

    case "uninstall-stack":
      await runUninstallStackCommand(scope);
      break;

    case "add":
      if (subcmd === "agent") {
        await runAddAgentCommand(scope);
      } else if (subcmd === "command") {
        await runAddCommandCommand(scope);
      } else if (subcmd === "skill") {
        await runAddSkillCommand(scope);
      } else if (subcmd === "mcp") {
        await runAddMcpCommand(scope);
      } else {
        console.error(`Tipo desconocido: "${subcmd}". Usa 'agent', 'command', 'skill' o 'mcp'.`);
        process.exit(1);
      }
      break;

    case "update":
      await runUpdateCommand(scope);
      break;

    case "uninstall":
      if (subcmd === "agent") {
        const name = argvNoScope[4];
        await runUninstallAgentCommand(name, scope);
      } else if (subcmd === "command") {
        const name = argvNoScope[4];
        await runUninstallCommandCommand(name, scope);
      } else if (subcmd === "skill") {
        const name = argvNoScope[4];
        await runUninstallSkillCommand(name, scope);
      } else if (subcmd === "mcp") {
        const name = argvNoScope[4];
        await runUninstallMcpCommand(name, scope);
      } else if (subcmd === undefined) {
        await runUninstallCommand(scope);
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
      // Sin argumentos → menú interactivo (pregunta local vs global, default local)
      await runInteractiveMenu(scope);
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
