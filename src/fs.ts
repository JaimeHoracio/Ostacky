import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
  rmSync,
  createWriteStream,
  renameSync,
} from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname, relative, basename } from "path";
import { execFileSync } from "child_process";
import { sha256 } from "./security.js";
import type { OpenCodePaths } from "./types.js";

export const USER_AGENT = "ostacky-installer";

export type { OpenCodePaths };

/**
 * Walks up the directory tree looking for a .opencode directory.
 * Stops at a .git boundary to avoid escaping the project.
 */
export function findOpenCodeDir(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  while (true) {
    const opencodeDir = join(current, ".opencode");
    if (existsSync(opencodeDir)) return opencodeDir;

    if (existsSync(join(current, ".git"))) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Finds the project root by walking up and looking for .opencode or .git.
 * Falls back to cwd if neither is found.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, ".opencode")) ||
      existsSync(join(current, ".git"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

/**
 * Ensures agents/, commands/, skills/, mcp/ and tools/ subdirs exist under an .opencode dir.
 */
export function ensureOpenCodePaths(opencodeDir: string): OpenCodePaths {
  const paths: OpenCodePaths = {
    root: opencodeDir,
    agents: join(opencodeDir, "agents"),
    commands: join(opencodeDir, "commands"),
    plugins: join(opencodeDir, "plugins"),
    skills: join(opencodeDir, "skills"),
    mcp: join(opencodeDir, "mcp"),
    tools: join(opencodeDir, "tools"),
  };
  for (const dir of [paths.root, paths.agents, paths.commands, paths.plugins, paths.skills, paths.mcp, paths.tools]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/**
 * Creates tool subdirectories inside .opencode/tools/ for each tool name.
 */
export function ensureToolDirs(toolsDir: string, toolNames: string[]): void {
  for (const name of toolNames) {
    const dir = join(toolsDir, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * Creates a fresh .opencode structure under baseDir.
 */
export function createOpenCodeDir(baseDir: string): OpenCodePaths {
  return ensureOpenCodePaths(join(baseDir, ".opencode"));
}

/**
 * Copies a directory recursively, creating subdirectories as needed.
 * Does not preserve permissions, symlinks, or timestamps — content only.
 * If `skipGenerated` is true, skips node_modules/ and package-lock.json
 * (useful when copying MCP server source without installed dependencies).
 */
export function copyDirRecursive(src: string, dest: string, skipGenerated: boolean = false): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skipGenerated && (entry === "node_modules" || entry === "package-lock.json")) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath, skipGenerated);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Computes a deterministic tree hash of a directory: lists sorted files,
 * concatenates relative paths + sha256 of each file's content, and returns
 * the sha256 hex of the combined block. Changes if any file's content
 * or path changes.
 */
export function computeTreeHash(dir: string): string {
  const lines: string[] = [];
  walkForHash(dir, dir, lines);
  const combined = lines.sort().join("\n");
  return createHash("sha256").update(combined, "utf-8").digest("hex");
}

/**
 * Internal recursive walker for computeTreeHash.
 * Collects `<relativePath>:<sha256(content)>` lines for every file.
 * Skips node_modules/ and package-lock.json — they are generated, not source.
 */
function walkForHash(root: string, current: string, lines: string[]): void {
  for (const entry of readdirSync(current)) {
    if (entry === "node_modules" || entry === "package-lock.json") continue;
    const full = join(current, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkForHash(root, full, lines);
    } else {
      const rel = relative(root, full);
      const content = readFileSync(full, "utf-8");
      lines.push(`${rel}:${sha256(content)}`);
    }
  }
}

/**
 * Checks whether a command exists on the system PATH.
 */
export function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the full path of an executable on the system PATH.
 * Returns null if not found.
 */
export function findExecutablePath(cmd: string): string | null {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(command, [cmd], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result
      .split(/\r?\n/)
      .map((entry: string) => entry.trim())
      .find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the appropriate Bun install command for the current platform.
 */
export function getBunInstallCommand(): { command: string; note?: string } {
  const platform = process.platform;
  
  if (platform === "darwin" || platform === "linux") {
    return {
      command: "curl -fsSL https://bun.com/install | bash",
      note: platform === "linux" ? "Requires 'unzip' package (sudo apt install unzip)" : undefined,
    };
  }
  
  if (platform === "win32") {
    return {
      command: 'powershell -c "irm bun.sh/install.ps1|iex"',
      note: "Requires Windows 10 v1809 or later",
    };
  }
  
  // Fallback: suggest npm install (cross-platform)
  return {
    command: "npm install -g bun",
    note: "Cross-platform fallback",
  };
}

/**
 * Checks if Bun is available and returns diagnostic info.
 * Useful for suggesting installation when Bun is missing.
 */
export function checkBunAvailability(): {
  available: boolean;
  path?: string;
  version?: string;
  installCommand?: string;
  installNote?: string;
} {
  const bunPath = findExecutablePath("bun");
  
  if (bunPath) {
    // Bun is available — try to get version
    let version: string | undefined;
    try {
      version = execFileSync(bunPath, ["--version"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      // Version check failed but binary exists
    }
    return { available: true, path: bunPath, version };
  }
  
  // Bun not found — provide install instructions
  const { command, note } = getBunInstallCommand();
  return {
    available: false,
    installCommand: command,
    installNote: note,
  };
}

/**
 * Detects the platform target triple (os-arch) for downloading the correct binary.
 * Returns null if the platform is not supported.
 */
export function detectPlatformTarget(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  let os: string;
  let cpu: string;
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "win32";
  else return null;
  if (arch === "arm64") cpu = "arm64";
  else if (arch === "x64") cpu = "x64";
  else return null;
  return `${os}-${cpu}`;
}

/** Returns the executable filename expected by the current platform. */
export function getExecutableName(name: string, platform: string = process.platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

/**
 * Returns all executable names supported by a bundled tool for a platform.
 * CodeGraph packages a `.cmd` launcher on Windows; other tools use `.exe`.
 */
export function getExecutableNames(name: string, platform: string = process.platform): string[] {
  if (platform !== "win32") return [name];
  return name === "codegraph" ? [`${name}.exe`, `${name}.cmd`] : [`${name}.exe`];
}

export interface CommandInvocation {
  command: string;
  args: string[];
}

/**
 * Converts Windows `.cmd` shims into an invocation that Node can spawn.
 * `execFile` cannot directly execute npm/npx `.cmd` wrappers on Windows.
 */
export function getCommandInvocation(
  command: string,
  args: string[],
  platform: string = process.platform
): CommandInvocation {
  const requiresCmd = platform === "win32" && (
    command.toLowerCase().endsWith(".cmd") || command === "npm" || command === "npx"
  );
  if (!requiresCmd) return { command, args };

  return {
    command: "cmd.exe",
    args: ["/d", "/c", "call", command, ...args],
  };
}

/**
 * Maps Node platform names to Engram's GitHub release naming convention.
 * Engram uses "windows" and "amd64", unlike Node's "win32" and "x64".
 */
export function getEngramReleaseTarget(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  const os = platform === "win32" ? "windows" : platform === "darwin" || platform === "linux" ? platform : null;
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  return os && cpu ? `${os}-${cpu}` : null;
}

/** Returns whether an error is transient enough to justify a download retry. */
export function shouldRetryDownload(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (status) {
    const code = Number(status);
    return code === 408 || code === 425 || code === 429 || code >= 500;
  }
  return /abort|timeout|timed out|econnreset|econnrefused|eai_again|enotfound|fetch failed|network/i.test(message);
}

export interface DirectoryPromotion {
  commit(): void;
  rollback(): void;
}

/**
 * Promotes a staged directory without deleting the previous installation until
 * the caller explicitly commits. This lets callers validate binaries and
 * configuration before an update becomes irreversible.
 */
export function promoteStagedDirectory(stagedDir: string, destinationDir: string): DirectoryPromotion {
  const backupDir = `${destinationDir}.backup-${process.pid}-${Date.now()}`;
  const hadDestination = existsSync(destinationDir);
  if (hadDestination) renameSync(destinationDir, backupDir);
  try {
    mkdirSync(dirname(destinationDir), { recursive: true });
    renameSync(stagedDir, destinationDir);
  } catch (error) {
    if (hadDestination && existsSync(backupDir)) renameSync(backupDir, destinationDir);
    throw error;
  }

  let settled = false;
  return {
    commit() {
      if (settled) return;
      if (hadDestination && existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
      settled = true;
    },
    rollback() {
      if (settled) return;
      if (existsSync(destinationDir)) rmSync(destinationDir, { recursive: true, force: true });
      if (hadDestination && existsSync(backupDir)) renameSync(backupDir, destinationDir);
      settled = true;
    },
  };
}

/**
 * Downloads a file from a URL to a local destination with a timeout.
 */
export function downloadToFile(url: string, dest: string, timeoutMs: number = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } })
      .then((res) => {
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status} ${res.statusText} descargando ${url}`);
        }
        const file = createWriteStream(dest);
        const fail = (error: Error) => {
          file.destroy();
          try { unlinkSync(dest); } catch {}
          reject(error);
        };
        file.once("error", fail);
        file.once("finish", resolve);
        const writable = new WritableStream({
          write(chunk: Uint8Array) {
            return new Promise<void>((ok, failWrite) =>
              file.write(Buffer.from(chunk), (err) => err ? failWrite(err) : ok())
            );
          },
          close() {
            file.end();
          },
        });
        return res.body.pipeTo(writable).catch(fail);
      })
      .then(() => {
        clearTimeout(timer);
      })
      .catch((err) => {
        clearTimeout(timer);
        try { unlinkSync(dest); } catch {}
        reject(err);
      });
  });
}

/**
 * Downloads a file with retry and exponential backoff.
 * @param url - The URL to download from
 * @param dest - The destination file path
 * @param maxRetries - Maximum number of retries (default: 2)
 * @param timeoutMs - Timeout per attempt (default: 180s)
 */
export async function downloadWithRetry(
  url: string,
  dest: string,
  maxRetries: number = 2,
  timeoutMs: number = 180_000
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await downloadToFile(url, dest, timeoutMs);
      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries && shouldRetryDownload(lastError)) {
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
        console.error(`[download] Intento ${attempt + 1} falló: ${lastError.message}. Reintentando en ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Downloads and extracts a tar.gz or zip archive from GitHub Releases to a destination directory.
 * Uses the platform tar implementation for both tar.gz and zip archives.
 * Archives are staged outside the live destination and promoted only after
 * successful extraction, so a failed update preserves the prior installation.
 */
export async function downloadAndExtract(
  url: string,
  destDir: string,
  stripComponents: number = 1,
  timeoutMs: number = 180_000
): Promise<DirectoryPromotion> {
  const tmp = join(dirname(destDir), `.${basename(destDir)}.download-${Date.now()}`);
  if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, url.endsWith(".zip") ? "archive.zip" : "archive.tar.gz");
  const extractedDir = join(tmp, "extracted");
  try {
    await downloadToFile(url, archivePath, timeoutMs);
    mkdirSync(extractedDir, { recursive: true });
    const args = url.endsWith(".zip")
      ? ["-xf", archivePath, "-C", extractedDir]
      : ["-xzf", archivePath, "-C", extractedDir];
    execFileSync("tar", args, { stdio: "pipe", timeout: 60_000 });

    let stagedDir = extractedDir;
    for (let component = 0; component < stripComponents; component++) {
      const entries = readdirSync(stagedDir);
      if (entries.length !== 1) {
        throw new Error(`No se puede remover ${stripComponents} componente(s) del archive: estructura inesperada.`);
      }
      const next = join(stagedDir, entries[0]);
      if (!statSync(next).isDirectory()) {
        throw new Error(`No se puede remover ${stripComponents} componente(s) del archive: falta directorio raíz.`);
      }
      stagedDir = next;
    }

    return promoteStagedDirectory(stagedDir, destDir);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Downloads and extracts an archive with retry and exponential backoff.
 * @param url - The URL to download from
 * @param destDir - The destination directory
 * @param stripComponents - Number of path components to strip (tar)
 * @param timeoutMs - Timeout per attempt (default: 180s)
 * @param maxRetries - Maximum number of retries (default: 2)
 */
export async function downloadAndExtractWithRetry(
  url: string,
  destDir: string,
  stripComponents: number = 1,
  timeoutMs: number = 180_000,
  maxRetries: number = 2
): Promise<DirectoryPromotion> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await downloadAndExtract(url, destDir, stripComponents, timeoutMs);
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries && shouldRetryDownload(lastError)) {
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
        console.error(`[download] Intento ${attempt + 1} falló: ${lastError.message}. Reintentando en ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Recursively searches for a binary by name inside a directory.
 * Returns the absolute path, or null if not found.
 */
export function findBinaryInDir(dir: string, name: string): string | null {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findBinaryInDir(full, name);
      if (found) return found;
    } else if (getExecutableNames(name).includes(entry)) {
      return full;
    }
  }
  return null;
}
