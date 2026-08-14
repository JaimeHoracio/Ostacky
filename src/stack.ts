import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import {
  findProjectRoot,
  findOpenCodeDir,
  downloadAndExtractWithRetry,
  findBinaryInDir,
  getCommandInvocation,
  getExecutableNames,
  getEngramReleaseTarget,
  getExecutableName,
  isCommandAvailable,
  type DirectoryPromotion,
  findExecutablePath,
  detectPlatformTarget,
} from "./fs.js";
import {
  findOpenCodeConfig,
  readOpenCodeConfig,
  writeOpenCodeConfig,
  ensureMcpEntryAtProjectRoot,
  patchOpenCodeConfig,
  setMcpEntryAtProjectRoot,
} from "./config.js";
import { fetchLatestReleaseTag, PACKAGE_ROOT } from "./github.js";
import type { OpenCodePaths } from "./types.js";

// ─── Stack installation (tools: CodeGraph, OpenSpec, Engram, Context7) ─────

/**
 * Result of installing the full tool stack.
 * Each field represents the outcome of one component.
 */
export interface StackResult {
  codegraph: { success: boolean; message: string };
  openspec: { success: boolean; message: string };
  engram: { success: boolean; message: string };
  context7: { success: boolean; message: string };
  config: { success: boolean; message: string };
}

interface ToolInstallLocation {
  projectRoot: string;
  toolsDir: string;
}

function resolveToolInstallLocation(toolsDir?: string): ToolInstallLocation {
  const resolvedToolsDir = resolve(toolsDir ?? join(findProjectRoot(), ".opencode", "tools"));
  const possibleOpenCodeDir = dirname(resolvedToolsDir);
  return {
    projectRoot: basename(possibleOpenCodeDir) === ".opencode"
      ? dirname(possibleOpenCodeDir)
      : findProjectRoot(),
    toolsDir: resolvedToolsDir,
  };
}

function runTool(binary: string, args: string[], cwd?: string, timeout = 30_000): void {
  const invocation = getCommandInvocation(binary, args);
  execFileSync(invocation.command, invocation.args, {
    cwd,
    stdio: "pipe",
    timeout,
  });
}

function findToolBinary(toolDir: string, name: string): string | null {
  const binDir = join(toolDir, "bin");
  for (const executable of getExecutableNames(name)) {
    const candidate = join(binDir, executable);
    if (existsSync(candidate)) return candidate;
  }
  return findBinaryInDir(toolDir, name);
}

function configureLocalTool(
  projectRoot: string,
  name: string,
  command: string[]
): void {
  setMcpEntryAtProjectRoot(projectRoot, name, {
    type: "local",
    command,
    enabled: true,
  });
}

/** Converts a local executable plus arguments into an OpenCode-safe MCP command. */
export function buildLocalMcpCommand(
  executable: string,
  args: string[],
  platform: string = process.platform
): string[] {
  const invocation = getCommandInvocation(executable, args, platform);
  return [invocation.command, ...invocation.args];
}

function copyEngramPlugin(projectRoot: string): void {
  const pluginSource = join(PACKAGE_ROOT, "assets", "plugins", "engram.ts");
  const pluginsDir = join(projectRoot, ".opencode", "plugins");
  if (!existsSync(pluginSource)) {
    throw new Error(`Plugin bundleado de Engram no encontrado: ${pluginSource}`);
  }
  mkdirSync(pluginsDir, { recursive: true });
  copyFileSync(pluginSource, join(pluginsDir, "engram.ts"));
}

/** Builds an Engram release URL using its platform-specific asset naming. */
export function buildEngramDownloadUrl(
  tag: string,
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  const target = getEngramReleaseTarget(platform, arch);
  if (!target) return null;
  const extension = platform === "win32" ? "zip" : "tar.gz";
  return `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${tag.replace(/^v/, "")}_${target.replace("-", "_")}.${extension}`;
}

/**
 * Installs CodeGraph (binary) locally to .opencode/tools/codegraph/.
 * Downloads the release archive from GitHub and extracts it to the tool directory.
 * Registers the MCP server entry pointing to the local binary.
 * Does not install anything globally — everything is local to the project.
 */
export async function installCodeGraph(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const location = resolveToolInstallLocation(toolsDir);
  const { projectRoot } = location;
  const cgToolDir = join(location.toolsDir, "codegraph");
  if (!existsSync(cgToolDir)) mkdirSync(cgToolDir, { recursive: true });

  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá CodeGraph manualmente.`,
    };
  }

  let localBin = findToolBinary(cgToolDir, "codegraph");
  let archivePromotion: DirectoryPromotion | null = null;
  const failAfterExtraction = (message: string): { success: false; message: string } => {
    try { archivePromotion?.rollback(); } catch {}
    return { success: false, message };
  };

  // Si ya está descargado localmente, lo usamos
  if (localBin) {
    try {
      runTool(localBin, ["--version"], projectRoot, 10_000);
    } catch {
      // Binario corrupto — re-descargar
      try { rmSync(cgToolDir, { recursive: true, force: true }); } catch {}
      localBin = null;
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!localBin) {
    const tag = await fetchLatestReleaseTag("colbymchenry/codegraph");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de CodeGraph desde GitHub.",
      };
    }
    const ext = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/codegraph-${target}.${ext}`;
    try {
      archivePromotion = await downloadAndExtractWithRetry(url, cgToolDir, 1, 180_000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando CodeGraph ${tag}: ${(e as Error).message}`,
      };
    }
    localBin = findToolBinary(cgToolDir, "codegraph");
    if (!localBin) {
      return failAfterExtraction(`Descarga de CodeGraph ${tag} completada pero no se encontró el binario en ${join(cgToolDir, "bin")}.`);
    }
    if (process.platform !== "win32") {
      try { chmodSync(localBin, 0o755); } catch {}
    }
  }

  try {
    runTool(localBin, ["--version"], projectRoot, 10_000);
  } catch (error) {
    return failAfterExtraction(`CodeGraph fue extraído pero no se puede ejecutar: ${(error as Error).message}`);
  }

  // Inicializar el índice de CodeGraph en el proyecto
  let indexWarning: string | null = null;
  try {
    runTool(localBin, ["init", "-i"], projectRoot, 120_000);
  } catch (error) {
    indexWarning = `El índice no se pudo inicializar todavía: ${(error as Error).message}`;
  }

  // Registrar directamente evita que `codegraph install` cree o mueva archivos
  // fuera de la configuración administrada por Ostacky.
  try {
    configureLocalTool(projectRoot, "codegraph", buildLocalMcpCommand(localBin, ["serve", "--mcp"]));
  } catch (error) {
    return failAfterExtraction(`CodeGraph fue instalado pero no se pudo configurar el MCP: ${(error as Error).message}`);
  }

  archivePromotion?.commit();

  return {
    success: true,
    message: indexWarning
      ? `CodeGraph instalado y configurado para OpenCode. ${indexWarning}`
      : "CodeGraph instalado localmente y configurado para OpenCode",
  };
}

/**
 * Configura OpenSpec para el proyecto via npx/bunx (sin requerir instalación global).
 * Usa bunx si bun está disponible, sino npx.
 *
 * Importante: el package real es `@fission-ai/openspec` (bin: `openspec`).
 * El nombre sin scope `openspec` está squatteado por un stub sin binario,
 * por eso `bunx openspec init` falla con `could not determine executable`.
 */
export const OPENSPEC_NPM_PACKAGE = "@fission-ai/openspec";

export function setupOpenSpec(projectRoot: string = findProjectRoot()): { success: boolean; message: string } {
  const useBun = isCommandAvailable("bun");
  const fail = (msg: string): { success: false; message: string } => ({ success: false, message: msg });

  // Intento 1: bunx/npx con nombre scoped (caso normal, sin side effects).
  const tryDirect = (): boolean => {
    try {
      const invocation = getCommandInvocation(useBun ? "bunx" : "npx", useBun
        ? [OPENSPEC_NPM_PACKAGE, "init", "--tools", "opencode", "--force"]
        : ["--yes", OPENSPEC_NPM_PACKAGE, "init", "--tools", "opencode", "--force"]);
      execFileSync(invocation.command, invocation.args, {
        stdio: "pipe",
        timeout: 120_000,
        cwd: projectRoot,
      });
      return true;
    } catch {
      return false;
    }
  };

  // Intento 2: instalar OpenSpec globalmente y ejecutar el binario directo.
  // Side effect: mutación del sistema (install -g). Solo se ejecuta si el intento 1 falló.
  const tryInstallGlobal = (): { ok: boolean; error?: string } => {
    if (!useBun && !isCommandAvailable("npm")) {
      return { ok: false, error: "Ni bun ni npm están disponibles para instalar OpenSpec globalmente" };
    }
    const pkgManager = useBun ? "bun" : "npm";
    const installArgs = useBun
      ? ["add", "-g", OPENSPEC_NPM_PACKAGE]
      : ["install", "-g", OPENSPEC_NPM_PACKAGE];
    try {
      const invocation = getCommandInvocation(pkgManager, installArgs);
      execFileSync(invocation.command, invocation.args, { stdio: "pipe", timeout: 120_000 });
    } catch (installErr) {
      return { ok: false, error: `Instalación global falló: ${(installErr as Error).message}` };
    }
    try {
      const retryInvocation = getCommandInvocation("openspec", ["init", "--tools", "opencode", "--force"]);
      execFileSync(retryInvocation.command, retryInvocation.args, {
        stdio: "pipe",
        timeout: 120_000,
        cwd: projectRoot,
      });
      return { ok: true };
    } catch (retryErr) {
      return { ok: false, error: `Reintento con binario global falló: ${(retryErr as Error).message}` };
    }
  };

  if (tryDirect()) {
    return { success: true, message: "OpenSpec configurado para OpenCode" };
  }

  const fallback = tryInstallGlobal();
  if (fallback.ok) {
    return {
      success: true,
      message: `OpenSpec configurado para OpenCode (binario instalado globalmente con ${useBun ? "bun" : "npm"})`,
    };
  }

  const manualCmd = useBun
    ? `bun add -g ${OPENSPEC_NPM_PACKAGE}`
    : `npm install -g ${OPENSPEC_NPM_PACKAGE}`;
  return fail(
    `Error configurando OpenSpec: ni bunx/npx ni la instalación global resolvieron el binario. `
    + `Solución manual: ejecuta \`${manualCmd}\` y luego corré /install-stack de nuevo. `
    + `Detalle: ${fallback.error}`
  );
}

/**
 * Installs Engram for the project.
 * - If global `engram` binary exists: uses it, only copies plugin locally
 * - If no global binary: downloads to .opencode/tools/engram/bin/
 * Registers the MCP server entry and installs the OpenCode plugin locally.
 */
export async function installEngram(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const location = resolveToolInstallLocation(toolsDir);
  const { projectRoot } = location;
  const engramToolDir = join(location.toolsDir, "engram");
  const engramBinDir = join(engramToolDir, "bin");
  if (!existsSync(engramBinDir)) mkdirSync(engramBinDir, { recursive: true });
  const localBin = join(engramBinDir, getExecutableName("engram"));
  let archivePromotion: DirectoryPromotion | null = null;
  const failAfterExtraction = (message: string): { success: false; message: string } => {
    try { archivePromotion?.rollback(); } catch {}
    return { success: false, message };
  };

  // Si ya está descargado localmente, lo usamos
  if (existsSync(localBin)) {
    try {
      runTool(localBin, ["--version"], projectRoot, 10_000);
    } catch {
      // Binario corrupto — re-descargar
      try { unlinkSync(localBin); } catch {}
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!existsSync(localBin)) {
    const globalBin = findExecutablePath("engram");
    const useGlobalBinary = globalBin && (
      process.platform !== "win32" || globalBin.toLowerCase().endsWith(".exe")
    );
    if (useGlobalBinary) {
      try {
        runTool(globalBin, ["--version"], projectRoot, 10_000);
        mkdirSync(engramBinDir, { recursive: true });
        copyFileSync(globalBin, localBin);
      } catch {
        try { unlinkSync(localBin); } catch {}
      }
    }
  }

  if (!existsSync(localBin)) {
    const tag = await fetchLatestReleaseTag("Gentleman-Programming/engram");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de Engram desde GitHub.",
      };
    }
    const url = buildEngramDownloadUrl(tag);
    if (!url) {
      return {
        success: false,
        message: `Plataforma no soportada para descargar Engram: ${process.platform}/${process.arch}.`,
      };
    }
    try {
      // Extraer al directorio base (no bin/) — el tar.gz puede tener estructura plana
      archivePromotion = await downloadAndExtractWithRetry(url, engramToolDir, 0, 120_000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando Engram ${tag}: ${(e as Error).message}`,
      };
    }
    mkdirSync(engramBinDir, { recursive: true });
    const found = findBinaryInDir(engramToolDir, "engram");
    if (!found) {
      return failAfterExtraction(`Descarga de Engram ${tag} completada pero no se encontró el binario en ${localBin}.`);
    }
    try {
      if (found !== localBin) copyFileSync(found, localBin);
    } catch (error) {
      return failAfterExtraction(`Engram fue descargado pero no se pudo materializar el binario local: ${(error as Error).message}`);
    }
    if (process.platform !== "win32") {
      try { chmodSync(localBin, 0o755); } catch {}
    }
  }

  try {
    runTool(localBin, ["--version"], projectRoot, 10_000);
    copyEngramPlugin(projectRoot);
    configureLocalTool(projectRoot, "engram", buildLocalMcpCommand(localBin, ["mcp"]));
  } catch (error) {
    return failAfterExtraction(`Engram fue instalado pero no se pudo verificar o configurar: ${(error as Error).message}`);
  }

  archivePromotion?.commit();

  return { success: true, message: "Engram instalado localmente y configurado para OpenCode (MCP + plugin)" };
}

/**
 * Configures Context7 for OpenCode.
 * Registers the remote MCP server in opencode.jsonc and creates
 * .opencode/tools/context7/. Also attempts to run `npx ctx7 setup --opencode`
 * to install the local skill.
 */
export function setupContext7(toolsDir?: string): { success: boolean; message: string } {
  const location = resolveToolInstallLocation(toolsDir);
  const { projectRoot } = location;
  const ctx7ToolDir = join(location.toolsDir, "context7");
  if (!existsSync(ctx7ToolDir)) mkdirSync(ctx7ToolDir, { recursive: true });

  // Registrar el MCP server remoto en opencode.jsonc
  try {
    ensureMcpEntryAtProjectRoot(projectRoot, "context7", {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
    });
  } catch (error) {
    return { success: false, message: `No se pudo registrar Context7: ${(error as Error).message}` };
  }

  // Intentar instalar el skill via ctx7 setup --opencode (no-fatal)
  // Usar bunx si bun está disponible, sino npx
  const useBun = isCommandAvailable("bun");
  try {
    const invocation = getCommandInvocation(useBun ? "bunx" : "npx", useBun
      ? ["ctx7", "setup", "--opencode"]
      : ["--yes", "ctx7", "setup", "--opencode"]);
    execFileSync(invocation.command, invocation.args, {
      stdio: "pipe",
      timeout: 60_000,
      cwd: projectRoot,
    });
    return { success: true, message: "Context7 configurado (MCP + skill instalado)" };
  } catch {
    // Si ctx7 setup falla, el MCP remoto ya está registrado — es suficiente
    return {
      success: true,
      message: "Context7 MCP registrado (skill opcional no instalada — corrí `npx ctx7 setup --opencode` manualmente si la querés)",
    };
  }
}

/**
 * Orchestrator: installs and configures the full tool stack
 * (CodeGraph + OpenSpec + Engram + Context7 + Config patch).
 * If toolsDir is provided, each tool creates its subdirectory there.
 * Async because CodeGraph and Engram download binaries.
 */
export async function installStack(toolsDir?: string): Promise<StackResult> {
  const { projectRoot } = resolveToolInstallLocation(toolsDir);
  return {
    codegraph: await installCodeGraph(toolsDir),
    openspec: setupOpenSpec(projectRoot),
    engram: await installEngram(toolsDir),
    context7: setupContext7(toolsDir),
    config: patchOpenCodeConfig(projectRoot),
  };
}

/**
 * Removes the Engram configuration from the project
 * (mcp.engram entry in opencode.json).
 * Does NOT uninstall the Engram binary or delete data,
 * only cleans up the project configuration.
 */
export function uninstallEngramConfig(): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const configPath = findOpenCodeConfig(projectRoot);

  if (!configPath) {
    return { success: false, message: "No se encontró opencode.json ni opencode.jsonc" };
  }

  const config = readOpenCodeConfig(configPath);
  if (!config) {
    return { success: false, message: `Error parseando ${configPath}` };
  }

  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (mcp && "engram" in mcp) {
    delete mcp.engram;
    if (Object.keys(mcp).length === 0) {
      delete config.mcp;
    }
    writeOpenCodeConfig(configPath, config);
    return { success: true, message: "Config de Engram eliminada de opencode.json" };
  }

  return { success: true, message: "Engram no estaba configurado en este proyecto" };
}

/**
 * Removes all stack configuration from the project:
 * - mcp.codegraph, mcp.context7, mcp.engram entries from opencode.json
 * - .codegraph/ directory
 * - .opencode/tools/ directory
 * Does NOT touch global binaries (codegraph, engram) or Engram data.
 */
export function uninstallStackConfig(paths: OpenCodePaths): { success: boolean; message: string } {
  const projectRoot = dirname(paths.root);
  const removed: string[] = [];

  // 1. Remover entradas MCP del stack de opencode.json
  const configPath = findOpenCodeConfig(projectRoot);
  if (configPath) {
    const config = readOpenCodeConfig(configPath);
    if (config) {
      const mcp = config.mcp as Record<string, unknown> | undefined;
      let changed = false;
      if (mcp) {
        for (const name of ["codegraph", "context7", "engram"]) {
          if (name in mcp) {
            delete mcp[name];
            removed.push(`mcp.${name}`);
            changed = true;
          }
        }
        if (Object.keys(mcp).length === 0) {
          delete config.mcp;
          changed = true;
        }
      }
      if (changed) {
        writeOpenCodeConfig(configPath, config);
      }
    }
  }

  // 2. Remover .codegraph/
  const codegraphDir = join(projectRoot, ".codegraph");
  if (existsSync(codegraphDir)) {
    try {
      rmSync(codegraphDir, { recursive: true, force: true });
      removed.push(".codegraph/");
    } catch {
      // no fatal
    }
  }

  // 3. Remover .opencode/tools/
  if (existsSync(paths.tools)) {
    try {
      rmSync(paths.tools, { recursive: true, force: true });
      removed.push(".opencode/tools/");
    } catch {
      // no fatal
    }
  }

  if (removed.length === 0) {
    return { success: true, message: "No había configuración del stack para remover" };
  }

  return {
    success: true,
    message: `Removido: ${removed.join(", ")}. Los binarios globales (codegraph, engram) no se tocaron.`,
  };
}

/**
 * Verifies that MCP server files exist and are valid.
 * Returns a list of verification results for each MCP server.
 */
export function verifyMcpServers(projectRoot: string): {
  ostackyController: { exists: boolean; path: string; error?: string };
  openspec: { exists: boolean; path: string; error?: string };
} {
  const opencodeDir = findOpenCodeDir(projectRoot);
  const mcpBase = opencodeDir ? join(opencodeDir, "mcp") : join(projectRoot, ".opencode", "mcp");

  const controllerPath = join(mcpBase, "ostacky-controller", "index.js");
  const openspecPath = join(mcpBase, "openspec", "index.js");

  const result = {
    ostackyController: {
      exists: existsSync(controllerPath),
      path: controllerPath,
    } as { exists: boolean; path: string; error?: string },
    openspec: {
      exists: existsSync(openspecPath),
      path: openspecPath,
    } as { exists: boolean; path: string; error?: string },
  };

  if (!result.ostackyController.exists) {
    result.ostackyController.error = "ostacky-controller MCP server not found";
  }
  if (!result.openspec.exists) {
    result.openspec.error = "openspec MCP server not found";
  }

  return result;
}
