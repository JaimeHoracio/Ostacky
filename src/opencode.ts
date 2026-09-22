import * as p from "@clack/prompts";
import { execSync, execFileSync } from "node:child_process";
import { isCommandAvailable } from "./fs.js";

/**
 * Verifica si OpenCode está disponible en el PATH.
 * Usa `which` en Unix y `where` en Windows (via isCommandAvailable).
 * También intenta `opencode --version` como segunda verificación.
 */
export function isOpencodeInstalled(): boolean {
  if (isCommandAvailable("opencode")) return true;
  // Fallback: intentar ejecutar opencode --version
  try {
    execFileSync("opencode", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsea el major version de `opencode --version`.
 * Acepta "opencode v2.0.12", "2.0.13", etc. Retorna null si no parsea.
 */
export function parseOpencodeVersion(output: string): number | null {
  const m = /v?(\d+)\.\d+\.\d+/.exec(output ?? "");
  if (!m) return null;
  const major = parseInt(m[1], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * Devuelve el stdout de `opencode --version`, o null si no se puede ejecutar.
 */
export function getOpencodeVersion(): string | null {
  try {
    return execFileSync("opencode", ["--version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Devuelve el comando de instalación recomendado según el sistema operativo.
 * Basado en https://opencode.ai/download y https://opencode.ai/v2/docs/cli
 *
 * - macOS / Linux: `curl -fsSL https://opencode.ai/install | bash` (oficial, hoy entrega V2)
 *   alternativas: brew install anomalyco/tap/opencode | npm install -g opencode-ai
 * - Windows: `npm install -g opencode-ai` (funciona con npm/bun/pnpm)
 *   alternativas: choco install opencode | scoop install opencode | brew en WSL
 * - Arch Linux: pacman/paru (informado solo como display)
 */
export function getOpencodeInstallCommand(
  platform: string = process.platform,
  _arch: string = process.arch,
): { display: string; command: string; args: string[]; note?: string } {
  if (platform === "win32") {
    return {
      display: "npm install -g opencode-ai",
      command: "npm",
      args: ["install", "-g", "opencode-ai"],
      note: "Alternativas Windows: choco install opencode | scoop install opencode | mise use -g github:anomalyco/opencode (ver https://opencode.ai/download). WSL recomendado.",
    };
  }
  if (platform === "darwin") {
    return {
      display: "curl -fsSL https://opencode.ai/install | bash",
      command: "bash",
      args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
      note: "Alternativa macOS: brew install anomalyco/tap/opencode (tap oficial, más actualizado que brew install opencode)",
    };
  }
  // linux y otros unix
  return {
    display: "curl -fsSL https://opencode.ai/install | bash",
    command: "bash",
    args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
    note: "Alternativas Linux: npm install -g opencode-ai | bun add -g opencode-ai | brew install anomalyco/tap/opencode | paru -S opencode (Arch)",
  };
}

/**
 * Gate obligatorio del instalador: verifica OpenCode como PRIMER paso.
 *
 * - Si está instalado → retorna inmediatamente (no interrumpe).
 * - Si no está → muestra mensaje exacto requerido, pregunta al usuario,
 *   si dice que no → corta la instalación (process.exit 1),
 *   si acepta → intenta instalar según SO, re-verifica y si falla corta con instrucciones manuales.
 *
 * Debe llamarse al inicio de cualquier flujo de instalación (menu, install, add, install-stack, update)
 * antes de pedir scope, cargar manifest o tocar el filesystem.
 */
export async function ensureOpencodeInstalled(): Promise<void> {
  if (isOpencodeInstalled()) {
    // Sin selector v1/v2: Ostacky requiere V2. V1 detectado → aviso y corte.
    const raw = getOpencodeVersion();
    const major = raw ? parseOpencodeVersion(raw) : null;
    if (major !== null && major < 2) {
      p.log.warn(`OpenCode V1 detectado (${raw}). Ostacky requiere OpenCode V2.`);
      p.note(
        "El instalador V2 reemplaza el binario V1. Desinstalá V1 (package manager) e instalá V2, luego re-ejecutá.\nDocs: https://opencode.ai/v2/docs/migrate-v1",
        "Actualización requerida"
      );
      process.exit(1);
    }
    return;
  }

  const platform = process.platform;
  const info = getOpencodeInstallCommand(platform);

  p.log.warn("OpenCode no detectado en este sistema.");
  p.note(`${info.display}\nDocs: https://opencode.ai/download${info.note ? `\n${info.note}` : ""}`, `Instalación requerida (${platform})`);

  const shouldInstall = await p.confirm({
    message: "Ostacky no funciona sin OpenCode. ¿Querés instalar OpenCode ahora?",
    initialValue: true,
  });

  if (p.isCancel(shouldInstall) || !shouldInstall) {
    p.outro("Instalación cancelada. Instalá OpenCode manualmente y volvé a ejecutar: https://opencode.ai/download");
    process.exit(1);
  }

  const spin = p.spinner();
  spin.start(`Instalando OpenCode (${info.display})...`);

  try {
    if (platform === "win32") {
      // Windows: npm es el método más universal (también funciona con bun/pnpm/yarn)
      // Intentar npm; si no está, el error caerá al catch y se mostrarán alternativas.
      execSync("npm install -g opencode-ai", { stdio: "inherit", shell: "cmd.exe" });
    } else {
      // Unix: script oficial. Requiere curl + bash.
      // Verificar curl disponible antes de intentar.
      if (!isCommandAvailable("curl")) {
        spin.stop("curl no disponible");
        p.log.warn("curl no está instalado — se intentará con npm como fallback.");
        execSync("npm install -g opencode-ai", { stdio: "inherit", shell: "/bin/bash" });
      } else {
        execSync("curl -fsSL https://opencode.ai/install | bash", { stdio: "inherit", shell: "/bin/bash" });
      }
    }
    spin.stop("Instalación ejecutada, verificando...");
  } catch (e) {
    spin.stop("Fallo la instalación automática.");
    const msg = (e as Error).message ?? String(e);
    p.log.error(`No se pudo instalar OpenCode automáticamente: ${msg}`);
    // Fallback hint por SO
    if (platform === "win32") {
      p.note(
        [
          "Intentá manualmente una de estas opciones:",
          "  npm install -g opencode-ai",
          "  choco install opencode",
          "  scoop install opencode",
          "  (WSL) curl -fsSL https://opencode.ai/install | bash",
          "Luego verificá: opencode --version",
          "Docs: https://opencode.ai/download",
        ].join("\n"),
        "Acción manual requerida",
      );
    } else {
      p.note(
        [
          "Intentá manualmente:",
          `  ${info.display}`,
          "  npm install -g opencode-ai  (si no tenés curl)",
          "  brew install anomalyco/tap/opencode  (macOS/Linux con brew)",
          "Luego verificá: opencode --version",
          "Docs: https://opencode.ai/download",
        ].join("\n"),
        "Acción manual requerida",
      );
    }
    process.exit(1);
  }

  // Re-verificar después de instalar
  if (!isOpencodeInstalled()) {
    p.log.error("OpenCode aún no está disponible en el PATH después de la instalación.");
    p.note(
      [
        "Probá cerrar y reabrir la terminal y ejecutar:",
        "  opencode --version",
        "Si persiste, instalá manualmente:",
        `  ${info.display}`,
        "Docs: https://opencode.ai/download",
      ].join("\n"),
      "Verificación falló",
    );
    process.exit(1);
  }

  p.log.success("OpenCode instalado correctamente ✓");
}
