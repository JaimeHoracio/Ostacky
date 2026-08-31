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
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { computeTreeHash, findOpenCodeDir } from "./fs.js";

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
  npx ostacky doctor                           Diagnostica locks, tools, state health
  npx ostacky status [--json]                  Muestra estado del controller sin MCP
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

async function runDoctorCommand() {
  const cwd = process.cwd();
  const opencodeDir = findOpenCodeDir(cwd) || join(cwd, ".opencode");
  const statePath = join(opencodeDir, "ostacky-state.json");
  let hasError = false;
  let hasWarn = false;

  const check = (label: string, ok: boolean, warn = false) => {
    if (ok) console.log(`✅ ${label}: OK`);
    else if (warn) { console.log(`⚠️ ${label}`); hasWarn = true; }
    else { console.log(`❌ ${label}`); hasError = true; }
  };

  // controller state
  try {
    if (!existsSync(statePath)) {
      check("controller: state file missing", false, true);
    } else {
      const stat = statSync(statePath);
      const raw = readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      check(`controller: OK (rev ${parsed.revision || 0} state ${parsed.state || "unknown"})`, true);
      if (parsed.degraded) { console.log("⚠️ degraded: true (persistido)"); hasWarn = true; }
      if (parsed.degradedEditsCount > 0) console.log(`⚠️ degraded: confirmation not audited in controller (degradedEditsCount=${parsed.degradedEditsCount})`);
      if (parsed.codegraphBypassCount > 0) console.log(`⚠️ codegraphBypassCount=${parsed.codegraphBypassCount} (inefficient: codegraph bypass)`);
      if (parsed.stateOversizedCount > 0) console.log(`⚠️ stateOversizedCount=${parsed.stateOversizedCount} snapshots perdidos`);
      if (parsed.sensitiveAccess) console.log(`ℹ️ sensitiveAccess: allowed=${parsed.sensitiveAccess.allowed || 0} denied=${parsed.sensitiveAccess.denied || 0} blocked=${parsed.sensitiveAccess.blockedAttempts || 0}`);
      if (parsed.sensitivePatterns) console.log(`ℹ️ sensitivePatterns: ${parsed.sensitivePatterns.join(", ")}`);
      if (parsed.allowedFiles && Object.keys(parsed.allowedFiles).length) console.log(`ℹ️ allowedFiles: ${Object.keys(parsed.allowedFiles).join(", ")}`);
      if (parsed.deniedFiles && Object.keys(parsed.deniedFiles).length) {
        console.log(`ℹ️ denied files: ${Object.keys(parsed.deniedFiles).join(", ")} (denied by user)`);
      }
      if (parsed.staleContentAttempts > 0) console.log(`⚠️ staleContentAttempts=${parsed.staleContentAttempts}`);
      if (parsed.completeWithoutValidateCount > 0) console.log(`⚠️ completeWithoutValidateCount=${parsed.completeWithoutValidateCount}`);
      if (stat.size > 2 * 1024 * 1024) { console.log("⚠️ state file >2MB (oversized)"); hasWarn = true; }
      // audit size
      const auditSize = (parsed.audit || []).length;
      if (auditSize > 500) console.log(`⚠️ audit large: ${auditSize}`);
      // disk free best-effort
      try {
        const { statfsSync } = await import("node:fs");
        if (typeof statfsSync === "function") {
          const s: any = (statfsSync as any)(dirname(statePath));
          const freeMB = Math.floor((s.bfree * s.bsize) / (1024 * 1024));
          if (freeMB < 100) { console.log(`⚠️ Disco casi lleno: ${freeMB}MB libres`); hasWarn = true; }
          else console.log(`ℹ️ diskFreeMB: ${freeMB}`);
        }
      } catch {}
      // liveness 11.4: detect freeze potential
      if ((parsed.state === "EXECUTING_INLINE" || parsed.state === "EXECUTING_SUBAGENTS") && parsed.expectedTasks) {
        const pending = parsed.expectedTasks.filter((id: string) => !parsed.tasks?.[id] || parsed.tasks[id].status !== "COMPLETED").length;
        const lastHandoffAge = parsed.lastHandoff ? Date.now() - parsed.lastHandoff.ts : Infinity;
        if (pending === 0 && lastHandoffAge > 60000) {
          console.log("⚠️ EXECUTING_* con pending==0 y lastHandoff >60s sin progreso — sugerir implementation_complete manual");
          hasWarn = true;
        }
      }
    }
  } catch (e) {
    check(`controller: ${(e as Error).message}`, false);
  }

  // locks
  try {
    const lockPid = join(opencodeDir, "ostacky-state.json.lock.pid");
    const lockTs = join(opencodeDir, "ostacky-state.json.lock.timestamp");
    if (existsSync(lockPid) || existsSync(lockTs)) {
      let ageStr = "";
      try {
        const ts = parseInt(readFileSync(lockTs, "utf-8"), 10);
        const age = Date.now() - ts;
        ageStr = `${Math.floor(age / 1000)}s`;
        const pid = readFileSync(lockPid, "utf-8").trim();
        let alive = false;
        try { process.kill(parseInt(pid, 10), 0); alive = true; } catch {}
        check(`lock: PID ${pid} age ${ageStr} alive=${alive}`, !alive || age > 15000, true);
      } catch {
        check("lock: exists (no timestamp)", false, true);
      }
    } else {
      check("lock: no active lock", true);
    }
  } catch {
    check("lock: check failed", false, true);
  }

  // binaries
  const tools = ["codegraph", "engram"];
  for (const t of tools) {
    const p = join(opencodeDir, "tools", t, "bin", t);
    const pExe = p + ".exe";
    check(`tool ${t}: ${existsSync(p) || existsSync(pExe) ? "found" : "missing"}`, existsSync(p) || existsSync(pExe), true);
  }

  // manifest hashes
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, "manifest.json"), "utf-8"));
    const expected = manifest.mcpServers?.find((x: any) => x.name === "ostacky-controller")?.sha256;
    if (expected) {
      const actual = computeTreeHash(join(cwd, "assets", "mcp", "ostacky-controller"));
      check(`manifest hash: ${expected.slice(0, 8)} vs actual ${actual.slice(0, 8)}`, expected === actual);
      if (expected !== actual) console.log("  Run: bun run hash:update");
    }
  } catch {
    check("manifest: not found", false, true);
  }

  // sensitive files denied check
  if (existsSync(statePath)) {
    try {
      const s = JSON.parse(readFileSync(statePath, "utf-8"));
      if (s.allowedFiles || s.deniedFiles) {
        // already logged above
      }
    } catch {}
  }

  // cache health (hardening-v2 5.4 + 6.2)
  try {
    const cacheDir = join(opencodeDir, "cache", "codegraph");
    if (!existsSync(cacheDir)) {
      console.log("ℹ️ cache: no cache dir yet (ok)");
    } else {
      const files = readdirSync(cacheDir);
      let total = 0;
      for (const f of files) {
        try { total += statSync(join(cacheDir, f)).size; } catch {}
      }
      const totalMB = (total / (1024 * 1024)).toFixed(2);
      if (total > 50 * 1024 * 1024) {
        console.log(`⚠️ cache: ${totalMB}MB >50MB — LRU cleanup needed`);
        hasWarn = true;
      } else {
        console.log(`✅ cache: OK (${files.length} files, ${totalMB}MB)`);
      }
      // report cache metrics from state if present
      try {
        const s = JSON.parse(readFileSync(statePath, "utf-8"));
        if (s.cacheHitCount !== undefined) {
          console.log(`ℹ️ cacheHitCount=${s.cacheHitCount} cacheMissCount=${s.cacheMissCount || 0} tokenSavingEstimate=${s.tokenSavingEstimate || 0}`);
        }
      } catch {}
    }
  } catch (e) {
    console.log(`⚠️ cache: check failed ${(e as Error).message}`);
  }

  // src/security.ts source-of-truth check (hardening-v2 D1)
  try {
    const secPath = join(cwd, "src", "security.ts");
    if (!existsSync(secPath)) {
      console.log("⚠️ src/security.ts: missing (source-of-truth)");
      hasWarn = true;
    } else {
      const sec = readFileSync(secPath, "utf-8");
      const hasSensitiveDefault = sec.includes("SENSITIVE_DEFAULT");
      const hasBashRe = sec.includes("BASH_SENSITIVE_RE");
      const hasIsSensitive = sec.includes("function isSensitive");
      const hasExtract = sec.includes("extractPathsFromBash");
      if (hasSensitiveDefault && hasBashRe && hasIsSensitive && hasExtract) {
        console.log("✅ src/security.ts: source-of-truth OK");
      } else {
        console.log("⚠️ src/security.ts: missing exports (SENSITIVE_DEFAULT/BASH_SENSITIVE_RE/isSensitive/extractPathsFromBash)");
        hasWarn = true;
      }
    }
  } catch {}

  // sensitiveAccess bash blocks check (hardening-v2 2.5)
  try {
    const s = JSON.parse(readFileSync(statePath, "utf-8"));
    if (s.sensitiveAccess?.blockedAttempts > 0) {
      console.log(`ℹ️ sensitiveAccess: blockedAttempts includes bash (${s.sensitiveAccess.blockedAttempts})`);
    }
  } catch {}

  if (hasError) process.exit(1);
  if (hasWarn) process.exit(0);
}

async function runStatusCommand(args: string[]) {
  const isJson = args.includes("--json");
  const cwd = process.cwd();
  const opencodeDir = findOpenCodeDir(cwd) || join(cwd, ".opencode");
  const statePath = join(opencodeDir, "ostacky-state.json");
  if (!existsSync(statePath)) {
    console.log(isJson ? JSON.stringify({ error: "no state" }) : "No state file");
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
    const completed = Object.values(parsed.tasks || {}).filter((t: any) => t.status === "COMPLETED").length;
    const expected = parsed.expectedTaskCount ?? parsed.expectedTasks?.length ?? Object.keys(parsed.tasks || {}).length;
    const degraded = parsed.degraded ? " degraded" : "";
    const lastHandoff = parsed.lastHandoff ? ` lastHandoff: ${parsed.lastHandoff.summary?.slice(0, 60)}` : "";
    if (isJson) {
      console.log(JSON.stringify({ state: parsed.state, revision: parsed.revision, degraded: !!parsed.degraded, tasks: `${completed}/${expected}`, lastHandoff: parsed.lastHandoff }, null, 2));
    } else {
      console.log(`${parsed.state} rev ${parsed.revision}${degraded} tasks ${completed}/${expected}${lastHandoff}`);
      if (parsed.lastProposal) console.log(`lastProposal: ${parsed.lastProposal.summary} shownToUser=${parsed.lastProposal.shownToUser}`);
    }
  } catch (e) {
    console.log(`Error reading state: ${(e as Error).message}`);
  }
}


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

    case "doctor":
      await runDoctorCommand();
      break;

    case "status":
      await runStatusCommand(argvNoScope.slice(3));
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
