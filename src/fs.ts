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
} from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname, relative } from "path";
import { execSync } from "child_process";
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
    if (process.platform === "win32") {
      execSync(`where ${cmd} >nul 2>&1`);
    } else {
      execSync(`which ${cmd} >/dev/null 2>&1`);
    }
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
    const result = execSync(
      process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return result || null;
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
      version = execSync("bun --version", {
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
export function detectPlatformTarget(): string | null {
  const platform = process.platform;
  const arch = process.arch;
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

/**
 * Downloads a file from a URL to a local destination with a timeout.
 */
export function downloadToFile(url: string, dest: string, timeoutMs: number = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    file.on("finish", () => resolve());
    file.on("error", (err) => reject(err));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } })
      .then((res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`HTTP ${res.status} ${res.statusText} descargando ${url}`));
          return;
        }
        const writable = new WritableStream({
          write(chunk: Uint8Array) {
            return new Promise<void>((ok, fail) => file.write(Buffer.from(chunk), (err) => err ? fail(err) : ok()));
          },
          close() {
            file.end();
          },
        });
        return res.body.pipeTo(writable);
      })
      .then(() => {
        clearTimeout(timer);
      })
      .catch((err) => {
        clearTimeout(timer);
        file.destroy();
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
      if (attempt < maxRetries) {
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
 * Uses tar (POSIX) or powershell tar (Windows) for tar.gz.
 * Uses Expand-Archive for zip on Windows.
 */
export async function downloadAndExtract(
  url: string,
  destDir: string,
  stripComponents: number = 1,
  timeoutMs: number = 180_000
): Promise<void> {
  const tmp = join(destDir, `.download-${Date.now()}`);
  if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, url.endsWith(".zip") ? "archive.zip" : "archive.tar.gz");
  try {
    await downloadToFile(url, archivePath, timeoutMs);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    if (process.platform === "win32" && url.endsWith(".zip")) {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
        { stdio: "pipe", timeout: 60_000 }
      );
    } else {
      const stripArg = stripComponents > 0 ? `--strip-components=${stripComponents}` : "";
      execSync(`tar -xzf "${archivePath}" -C "${destDir}" ${stripArg}`, {
        stdio: "pipe",
        timeout: 60_000,
      });
    }
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
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await downloadAndExtract(url, destDir, stripComponents, timeoutMs);
      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
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
    } else if (entry === name || entry === name + ".exe") {
      return full;
    }
  }
  return null;
}
