import { existsSync, mkdirSync, copyFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  findProjectRoot,
  findOpenCodeDir,
  ensureToolDirs,
  downloadToFile,
  downloadAndExtractWithRetry,
  findBinaryInDir,
  isCommandAvailable,
  detectPlatformTarget,
} from "./fs.js";
import {
  findOpenCodeConfig,
  readOpenCodeConfig,
  writeOpenCodeConfig,
  setMcpEntry,
  ensureMcpEntry,
  patchOpenCodeConfig,
} from "./config.js";
import { fetchLatestReleaseTag } from "./github.js";
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

/**
 * Installs CodeGraph (binary) locally to .opencode/tools/codegraph/.
 * Downloads the release archive from GitHub and extracts it to the tool directory.
 * Registers the MCP server entry pointing to the local binary.
 * Does not install anything globally — everything is local to the project.
 */
export async function installCodeGraph(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const projectRoot = findProjectRoot();
  const cgToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "codegraph");
  if (!existsSync(cgToolDir)) mkdirSync(cgToolDir, { recursive: true });

  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá CodeGraph manualmente.`,
    };
  }

  const localBin = join(cgToolDir, "bin", "codegraph");
  const localBinExe = localBin + (process.platform === "win32" ? ".exe" : "");

  // Si ya está descargado localmente, lo usamos
  if (existsSync(localBinExe)) {
    try {
      execSync(`"${localBinExe}" --version`, { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Binario corrupto — re-descargar
      try { rmSync(join(cgToolDir, "bin"), { recursive: true, force: true }); } catch {}
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!existsSync(localBinExe)) {
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
      await downloadAndExtractWithRetry(url, cgToolDir, 1, 180_000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando CodeGraph ${tag}: ${(e as Error).message}`,
      };
    }
    if (!existsSync(localBinExe)) {
      return {
        success: false,
        message: `Descarga de CodeGraph ${tag} completada pero no se encontró el binario en ${localBinExe}.`,
      };
    }
    if (process.platform !== "win32") {
      try { execSync(`chmod +x "${localBinExe}"`, { stdio: "pipe" }); } catch {}
    }
  }

  // Inicializar el índice de CodeGraph en el proyecto
  try {
    execSync(`"${localBinExe}" init -i`, { stdio: "pipe", timeout: 120_000, cwd: projectRoot });
  } catch {
    // No fatal — el índice puede inicializarse después
  }

  // Ejecutar codegraph install --target opencode para configurar MCP y crear AGENTS.md
  // --target opencode asegura que SOLO toca opencode (no .claude/, .cursor/, etc.)
  // --location local usa el binario local (no global)
  try {
    execSync(`"${localBinExe}" install --target opencode --location local --yes`, {
      stdio: "pipe",
      timeout: 30_000,
      cwd: projectRoot,
    });
  } catch {
    // No fatal — la entrada MCP la seteamos nosotros abajo
  }

  // Mover AGENTS.md si codegraph lo creó en la raíz → .opencode/tools/codegraph/AGENTS.md
  const rootAgentsMd = join(projectRoot, "AGENTS.md");
  if (existsSync(rootAgentsMd)) {
    const dest = join(cgToolDir, "AGENTS.md");
    try {
      copyFileSync(rootAgentsMd, dest);
      unlinkSync(rootAgentsMd);
    } catch {
      // Si no se puede mover, lo dejamos — no es crítico
    }
  }

  // Re-assert nuestro MCP entry (en caso de que codegraph install lo haya cambiado)
  // Siempre apuntamos al binario local en .opencode/tools/codegraph/bin/codegraph
  setMcpEntry("codegraph", {
    type: "local",
    command: [`.opencode/tools/codegraph/bin/codegraph`, "serve", "--mcp"],
    enabled: true,
  });

  return { success: true, message: "CodeGraph instalado localmente en .opencode/tools/codegraph/ y configurado para OpenCode" };
}

/**
 * Configura OpenSpec para el proyecto via npx/bunx (sin requerir instalación global).
 * Usa bunx si bun está disponible, sino npx.
 */
export function setupOpenSpec(): { success: boolean; message: string } {
  const npxCmd = isCommandAvailable("bun") ? "bunx" : "npx --yes";
  try {
    execSync(`${npxCmd} openspec init --tools opencode --force`, {
      stdio: "pipe",
      timeout: 120_000,
    });
    return { success: true, message: "OpenSpec configurado para OpenCode" };
  } catch (e) {
    return {
      success: false,
      message: `Error configurando OpenSpec: ${(e as Error).message}`,
    };
  }
}

/**
 * Installs Engram for the project.
 * - If global `engram` binary exists: uses it, only copies plugin locally
 * - If no global binary: downloads to .opencode/tools/engram/bin/
 * Registers the MCP server entry and installs the OpenCode plugin locally.
 */
export async function installEngram(toolsDir?: string): Promise<{ success: boolean; message: string }> {
  const projectRoot = findProjectRoot();

  // Check if Engram is already available globally — skip local install if so
  const globalBin = Bun.which("engram");
  if (globalBin) {
    // Global binary exists — create local symlink so MCP entry works portably
    const engramToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "engram");
    const engramBinDir = join(engramToolDir, "bin");
    if (!existsSync(engramBinDir)) mkdirSync(engramBinDir, { recursive: true });
    const localBin = join(engramBinDir, "engram" + (process.platform === "win32" ? ".exe" : ""));
    if (!existsSync(localBin)) {
      try { unlinkSync(localBin); } catch {}
      try {
        if (process.platform !== "win32") {
          execSync(`ln -s "${globalBin}" "${localBin}"`, { stdio: "pipe" });
        } else {
          copyFileSync(globalBin, localBin);
        }
      } catch {
        // Symlink failed — MCP entry will still work if user adds global to PATH
      }
    }

    // Register MCP entry pointing to local path (symlink or fallback)
    setMcpEntry("engram", {
      type: "local",
      command: [`.opencode/tools/engram/bin/engram`, "mcp"],
      enabled: true,
    });

    // Copy plugin from assets/ to .opencode/plugins/ (always local)
    const pluginSource = join(projectRoot, "assets", "plugins", "engram.ts");
    const pluginsDir = join(projectRoot, ".opencode", "plugins");
    const pluginTarget = join(pluginsDir, "engram.ts");
    if (existsSync(pluginSource)) {
      if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });
      try {
        copyFileSync(pluginSource, pluginTarget);
      } catch {
        // Plugin copy failed but global binary and MCP entry are set up
      }
    }

    return { success: true, message: `Engram global detectado en ${globalBin} — usando binario global. Plugin copiado a .opencode/plugins/` };
  }

  const engramToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "engram");
  const engramBinDir = join(engramToolDir, "bin");
  if (!existsSync(engramBinDir)) mkdirSync(engramBinDir, { recursive: true });

  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá Engram manualmente.`,
    };
  }

  const localBin = join(engramBinDir, "engram" + (process.platform === "win32" ? ".exe" : ""));

  // Si ya está descargado localmente, lo usamos
  if (existsSync(localBin)) {
    try {
      execSync(`"${localBin}" --version`, { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Binario corrupto — re-descargar
      try { unlinkSync(localBin); } catch {}
    }
  }

  // Descargar el binario si no está o se corrompió
  if (!existsSync(localBin)) {
    const tag = await fetchLatestReleaseTag("Gentleman-Programming/engram");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de Engram desde GitHub.",
      };
    }
    // Engram usa versiones sin 'v' en el nombre del asset: engram_1.20.0_linux_amd64.tar.gz
    const versionNum = tag.replace(/^v/, "");
    const [os, cpu] = target.split("-");
    // Engram usa amd64 en vez de x64
    const engramCpu = cpu === "x64" ? "amd64" : cpu;
    const ext = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${versionNum}_${os}_${engramCpu}.${ext}`;
    try {
      // Extraer al directorio base (no bin/) — el tar.gz puede tener estructura plana
      await downloadAndExtractWithRetry(url, engramToolDir, 0, 120_000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando Engram ${tag}: ${(e as Error).message}`,
      };
    }
    // Buscar el binario extraído y moverlo a bin/
    const extractedBin = join(engramToolDir, "engram" + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(extractedBin) && extractedBin !== localBin) {
      try {
        copyFileSync(extractedBin, localBin);
        unlinkSync(extractedBin);
      } catch {}
    }
    if (!existsSync(localBin)) {
      // Puede estar en un subdirectorio — buscarlo
      const found = findBinaryInDir(engramToolDir, "engram");
      if (found && found !== localBin) {
        try {
          copyFileSync(found, localBin);
          if (process.platform !== "win32") execSync(`chmod +x "${localBin}"`, { stdio: "pipe" });
        } catch {}
      }
    }
    if (!existsSync(localBin)) {
      return {
        success: false,
        message: `Descarga de Engram ${tag} completada pero no se encontró el binario en ${localBin}.`,
      };
    }
    if (process.platform !== "win32") {
      try { execSync(`chmod +x "${localBin}"`, { stdio: "pipe" }); } catch {}
    }
  }

  // Registrar el MCP server apuntando al binario local en bin/
  setMcpEntry("engram", {
    type: "local",
    command: [`.opencode/tools/engram/bin/engram`, "mcp"],
    enabled: true,
  });

  // Copiar el plugin de Engram de assets/ a .opencode/plugins/
  const pluginSource = join(projectRoot, "assets", "plugins", "engram.ts");
  const pluginsDir = join(projectRoot, ".opencode", "plugins");
  const pluginTarget = join(pluginsDir, "engram.ts");
  if (existsSync(pluginSource)) {
    if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });
    try {
      copyFileSync(pluginSource, pluginTarget);
    } catch {
      // Plugin copy failed but binary and MCP entry are already set up
    }
  }

  return { success: true, message: "Engram instalado localmente en .opencode/tools/engram/bin/ y configurado para OpenCode (MCP + plugin)" };
}

/**
 * Configures Context7 for OpenCode.
 * Registers the remote MCP server in opencode.jsonc and creates
 * .opencode/tools/context7/. Also attempts to run `npx ctx7 setup --opencode`
 * to install the local skill.
 */
export function setupContext7(toolsDir?: string): { success: boolean; message: string } {
  const projectRoot = findProjectRoot();
  const ctx7ToolDir = join(toolsDir ?? join(projectRoot, ".opencode", "tools"), "context7");
  if (!existsSync(ctx7ToolDir)) mkdirSync(ctx7ToolDir, { recursive: true });

  // Registrar el MCP server remoto en opencode.jsonc
  ensureMcpEntry("context7", {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    enabled: true,
  });

  // Intentar instalar el skill via ctx7 setup --opencode (no-fatal)
  // Usar bunx si bun está disponible, sino npx
  const npxCmd = isCommandAvailable("bun") ? "bunx" : "npx --yes";
  try {
    execSync(`${npxCmd} ctx7 setup --opencode`, {
      stdio: "pipe",
      timeout: 60_000,
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
  return {
    codegraph: await installCodeGraph(toolsDir),
    openspec: setupOpenSpec(),
    engram: await installEngram(toolsDir),
    context7: setupContext7(toolsDir),
    config: patchOpenCodeConfig(),
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
  const projectRoot = findProjectRoot();
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
