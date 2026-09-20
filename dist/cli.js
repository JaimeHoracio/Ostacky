#!/usr/bin/env node
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};

// node_modules/sisteransi/src/index.js
var require_src = __commonJS(function(exports, module) {
  var ESC = "\x1B";
  var CSI = `${ESC}[`;
  var beep = "\x07";
  var cursor = {
    to(x, y) {
      if (!y)
        return `${CSI}${x + 1}G`;
      return `${CSI}${y + 1};${x + 1}H`;
    },
    move(x, y) {
      let ret = "";
      if (x < 0)
        ret += `${CSI}${-x}D`;
      else if (x > 0)
        ret += `${CSI}${x}C`;
      if (y < 0)
        ret += `${CSI}${-y}A`;
      else if (y > 0)
        ret += `${CSI}${y}B`;
      return ret;
    },
    up: (count = 1) => `${CSI}${count}A`,
    down: (count = 1) => `${CSI}${count}B`,
    forward: (count = 1) => `${CSI}${count}C`,
    backward: (count = 1) => `${CSI}${count}D`,
    nextLine: (count = 1) => `${CSI}E`.repeat(count),
    prevLine: (count = 1) => `${CSI}F`.repeat(count),
    left: `${CSI}G`,
    hide: `${CSI}?25l`,
    show: `${CSI}?25h`,
    save: `${ESC}7`,
    restore: `${ESC}8`
  };
  var scroll = {
    up: (count = 1) => `${CSI}S`.repeat(count),
    down: (count = 1) => `${CSI}T`.repeat(count)
  };
  var erase = {
    screen: `${CSI}2J`,
    up: (count = 1) => `${CSI}1J`.repeat(count),
    down: (count = 1) => `${CSI}J`.repeat(count),
    line: `${CSI}2K`,
    lineEnd: `${CSI}K`,
    lineStart: `${CSI}1K`,
    lines(count) {
      let clear = "";
      for (let i = 0;i < count; i++)
        clear += this.line + (i < count - 1 ? cursor.up() : "");
      if (count)
        clear += cursor.left;
      return clear;
    }
  };
  module.exports = { cursor, scroll, erase, beep };
});

// node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS(function(exports, module) {
  var p = process || {};
  var argv = p.argv || [];
  var env = p.env || {};
  var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
  var formatter = (open, close, replace = open) => (input) => {
    let string = "" + input, index = string.indexOf(close, open.length);
    return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
  };
  var replaceClose = (string, close, replace, index) => {
    let result = "", cursor = 0;
    do {
      result += string.substring(cursor, index) + replace;
      cursor = index + close.length;
      index = string.indexOf(close, cursor);
    } while (~index);
    return result + string.substring(cursor);
  };
  var createColors = (enabled = isColorSupported) => {
    let f = enabled ? formatter : () => String;
    return {
      isColorSupported: enabled,
      reset: f("\x1B[0m", "\x1B[0m"),
      bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
      dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
      italic: f("\x1B[3m", "\x1B[23m"),
      underline: f("\x1B[4m", "\x1B[24m"),
      inverse: f("\x1B[7m", "\x1B[27m"),
      hidden: f("\x1B[8m", "\x1B[28m"),
      strikethrough: f("\x1B[9m", "\x1B[29m"),
      black: f("\x1B[30m", "\x1B[39m"),
      red: f("\x1B[31m", "\x1B[39m"),
      green: f("\x1B[32m", "\x1B[39m"),
      yellow: f("\x1B[33m", "\x1B[39m"),
      blue: f("\x1B[34m", "\x1B[39m"),
      magenta: f("\x1B[35m", "\x1B[39m"),
      cyan: f("\x1B[36m", "\x1B[39m"),
      white: f("\x1B[37m", "\x1B[39m"),
      gray: f("\x1B[90m", "\x1B[39m"),
      bgBlack: f("\x1B[40m", "\x1B[49m"),
      bgRed: f("\x1B[41m", "\x1B[49m"),
      bgGreen: f("\x1B[42m", "\x1B[49m"),
      bgYellow: f("\x1B[43m", "\x1B[49m"),
      bgBlue: f("\x1B[44m", "\x1B[49m"),
      bgMagenta: f("\x1B[45m", "\x1B[49m"),
      bgCyan: f("\x1B[46m", "\x1B[49m"),
      bgWhite: f("\x1B[47m", "\x1B[49m"),
      blackBright: f("\x1B[90m", "\x1B[39m"),
      redBright: f("\x1B[91m", "\x1B[39m"),
      greenBright: f("\x1B[92m", "\x1B[39m"),
      yellowBright: f("\x1B[93m", "\x1B[39m"),
      blueBright: f("\x1B[94m", "\x1B[39m"),
      magentaBright: f("\x1B[95m", "\x1B[39m"),
      cyanBright: f("\x1B[96m", "\x1B[39m"),
      whiteBright: f("\x1B[97m", "\x1B[39m"),
      bgBlackBright: f("\x1B[100m", "\x1B[49m"),
      bgRedBright: f("\x1B[101m", "\x1B[49m"),
      bgGreenBright: f("\x1B[102m", "\x1B[49m"),
      bgYellowBright: f("\x1B[103m", "\x1B[49m"),
      bgBlueBright: f("\x1B[104m", "\x1B[49m"),
      bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
      bgCyanBright: f("\x1B[106m", "\x1B[49m"),
      bgWhiteBright: f("\x1B[107m", "\x1B[49m")
    };
  };
  module.exports = createColors();
  module.exports.createColors = createColors;
});

// src/security.ts
import { createHash } from "node:crypto";
function validateFilePath(filePath) {
  if (filePath.includes("..") || filePath.startsWith("/") || filePath.startsWith("\\") || /^[a-zA-Z]:/.test(filePath)) {
    throw new Error(`Ruta de archivo inválida: "${filePath}"`);
  }
}
function sha256(content) {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
function verifyChecksum(content, expectedHash, label) {
  if (!expectedHash)
    return;
  const actual = sha256(content);
  if (actual !== expectedHash) {
    throw new Error(`Checksum inválido para "${label}"
  esperado: ${expectedHash}
  recibido: ${actual}`);
  }
}
var init_security = () => {};

// src/fs.ts
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
  renameSync
} from "fs";
import { createHash as createHash2 } from "crypto";
import { join, resolve, dirname, relative, basename } from "path";
import { execFileSync } from "child_process";
function findOpenCodeDir(startDir = process.cwd()) {
  let current = resolve(startDir);
  while (true) {
    const opencodeDir = join(current, ".opencode");
    if (existsSync(opencodeDir))
      return opencodeDir;
    if (existsSync(join(current, ".git")))
      return null;
    const parent = dirname(current);
    if (parent === current)
      return null;
    current = parent;
  }
}
function findProjectRoot(startDir = process.cwd()) {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8", cwd: startDir, stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (out && existsSync(out))
      return resolve(out);
  } catch {}
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, ".opencode")) || existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current)
      return resolve(startDir);
    current = parent;
  }
}
function getOpenCodeDirForScope(scope, cwd = process.cwd()) {
  const existing = findOpenCodeDir(cwd);
  if (existing)
    return existing;
  return join(findProjectRoot(cwd), ".opencode");
}
function ensureOpenCodePaths(opencodeDir) {
  const paths = {
    root: opencodeDir,
    agents: join(opencodeDir, "agents"),
    commands: join(opencodeDir, "commands"),
    plugins: join(opencodeDir, "plugins"),
    skills: join(opencodeDir, "skills"),
    mcp: join(opencodeDir, "mcp"),
    tools: join(opencodeDir, "tools")
  };
  for (const dir of [paths.root, paths.agents, paths.commands, paths.plugins, paths.skills, paths.mcp, paths.tools]) {
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
  }
  return paths;
}
function ensureToolDirs(toolsDir, toolNames) {
  for (const name of toolNames) {
    const dir = join(toolsDir, name);
    if (!existsSync(dir))
      mkdirSync(dir, { recursive: true });
  }
}
function copyDirRecursive(src, dest, skipGenerated = false) {
  if (!existsSync(dest))
    mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skipGenerated && (entry === "node_modules" || entry === "package-lock.json"))
      continue;
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
function computeTreeHash(dir) {
  const lines = [];
  walkForHash(dir, dir, lines);
  const combined = lines.sort().join(`
`);
  return createHash2("sha256").update(combined, "utf-8").digest("hex");
}
function walkForHash(root, current, lines) {
  for (const entry of readdirSync(current)) {
    if (entry === "node_modules" || entry === "package-lock.json")
      continue;
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
function isCommandAvailable(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}
function findExecutablePath(cmd) {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(command, [cmd], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return result.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}
function detectPlatformTarget(platform = process.platform, arch = process.arch) {
  let os;
  let cpu;
  if (platform === "darwin")
    os = "darwin";
  else if (platform === "linux")
    os = "linux";
  else if (platform === "win32")
    os = "win32";
  else
    return null;
  if (arch === "arm64")
    cpu = "arm64";
  else if (arch === "x64")
    cpu = "x64";
  else
    return null;
  return `${os}-${cpu}`;
}
function getExecutableName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}
function getExecutableNames(name, platform = process.platform) {
  if (platform !== "win32")
    return [name];
  return name === "codegraph" ? [`${name}.exe`, `${name}.cmd`] : [`${name}.exe`];
}
function getCommandInvocation(command, args, platform = process.platform) {
  const requiresCmd = platform === "win32" && (command.toLowerCase().endsWith(".cmd") || command === "npm" || command === "npx");
  if (!requiresCmd)
    return { command, args };
  return {
    command: "cmd.exe",
    args: ["/d", "/c", "call", command, ...args]
  };
}
function getEngramReleaseTarget(platform = process.platform, arch = process.arch) {
  const os = platform === "win32" ? "windows" : platform === "darwin" || platform === "linux" ? platform : null;
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  return os && cpu ? `${os}-${cpu}` : null;
}
function shouldRetryDownload(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  if (status) {
    const code = Number(status);
    return code === 408 || code === 425 || code === 429 || code >= 500;
  }
  return /abort|timeout|timed out|econnreset|econnrefused|eai_again|enotfound|fetch failed|network/i.test(message);
}
function promoteStagedDirectory(stagedDir, destinationDir) {
  const backupDir = `${destinationDir}.backup-${process.pid}-${Date.now()}`;
  const hadDestination = existsSync(destinationDir);
  if (hadDestination)
    renameSync(destinationDir, backupDir);
  try {
    mkdirSync(dirname(destinationDir), { recursive: true });
    renameSync(stagedDir, destinationDir);
  } catch (error) {
    if (hadDestination && existsSync(backupDir))
      renameSync(backupDir, destinationDir);
    throw error;
  }
  let settled = false;
  return {
    commit() {
      if (settled)
        return;
      if (hadDestination && existsSync(backupDir))
        rmSync(backupDir, { recursive: true, force: true });
      settled = true;
    },
    rollback() {
      if (settled)
        return;
      if (existsSync(destinationDir))
        rmSync(destinationDir, { recursive: true, force: true });
      if (hadDestination && existsSync(backupDir))
        renameSync(backupDir, destinationDir);
      settled = true;
    }
  };
}
function downloadToFile(url, dest, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } }).then((res) => {
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText} descargando ${url}`);
      }
      const file = createWriteStream(dest);
      const fail = (error) => {
        file.destroy();
        try {
          unlinkSync(dest);
        } catch {}
        reject(error);
      };
      file.once("error", fail);
      file.once("finish", resolve);
      const writable = new WritableStream({
        write(chunk) {
          return new Promise((ok, failWrite) => file.write(Buffer.from(chunk), (err) => err ? failWrite(err) : ok()));
        },
        close() {
          file.end();
        }
      });
      return res.body.pipeTo(writable).catch(fail);
    }).then(() => {
      clearTimeout(timer);
    }).catch((err) => {
      clearTimeout(timer);
      try {
        unlinkSync(dest);
      } catch {}
      reject(err);
    });
  });
}
async function downloadAndExtract(url, destDir, stripComponents = 1, timeoutMs = 180000) {
  const tmp = join(dirname(destDir), `.${basename(destDir)}.download-${Date.now()}-${process.pid}`);
  if (!existsSync(tmp))
    mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, url.endsWith(".zip") ? "archive.zip" : "archive.tar.gz");
  const extractedDir = join(tmp, "extracted");
  try {
    await downloadToFile(url, archivePath, timeoutMs);
    mkdirSync(extractedDir, { recursive: true });
    const args = url.endsWith(".zip") ? ["-xf", archivePath, "-C", extractedDir] : ["-xzf", archivePath, "-C", extractedDir];
    execFileSync("tar", args, { stdio: "pipe", timeout: 60000 });
    let stagedDir = extractedDir;
    for (let component = 0;component < stripComponents; component++) {
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
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}
async function downloadAndExtractWithRetry(url, destDir, stripComponents = 1, timeoutMs = 180000, maxRetries = 2) {
  let lastError = null;
  for (let attempt = 0;attempt <= maxRetries; attempt++) {
    try {
      return await downloadAndExtract(url, destDir, stripComponents, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && shouldRetryDownload(lastError)) {
        const delay = 1000 * Math.pow(2, attempt);
        console.error(`[download] Intento ${attempt + 1} falló: ${lastError.message}. Reintentando en ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
function findBinaryInDir(dir, name) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findBinaryInDir(full, name);
      if (found)
        return found;
    } else if (getExecutableNames(name).includes(entry)) {
      return full;
    }
  }
  return null;
}
function ensureGitignore(projectRoot = findProjectRoot()) {
  const gitignorePath = join(projectRoot, ".gitignore");
  const patternsAdded = [];
  let created = false;
  let updated = false;
  let raw = "";
  if (existsSync(gitignorePath)) {
    raw = readFileSync(gitignorePath, "utf-8");
  } else {
    created = true;
  }
  const hasHeader = raw.includes(OSTACKY_GITIGNORE_HEADER);
  const missingPatterns = OSTACKY_GITIGNORE_PATTERNS.filter((p) => !raw.includes(p));
  if (missingPatterns.length === 0 && hasHeader) {
    if (raw.length > 0 && !raw.endsWith(`
`)) {
      writeFileSync(gitignorePath, raw + `
`, "utf-8");
      updated = true;
    }
    return { created, updated, patternsAdded };
  }
  if (!hasHeader) {
    const needsNewline = raw.length > 0 && !raw.endsWith(`
`);
    const block = [OSTACKY_GITIGNORE_HEADER, ...OSTACKY_GITIGNORE_PATTERNS].join(`
`) + `
`;
    const newContent = raw + (needsNewline ? `
` : raw.length > 0 ? "" : "") + block;
    let final = "";
    if (raw.length === 0) {
      final = block;
    } else if (raw.endsWith(`
`)) {
      final = raw + block;
    } else {
      final = raw + `
` + block;
    }
    writeFileSync(gitignorePath, final, "utf-8");
    patternsAdded.push(...missingPatterns.length ? missingPatterns : [...OSTACKY_GITIGNORE_PATTERNS]);
    updated = true;
    return { created, updated, patternsAdded };
  }
  const lines = raw.split(`
`);
  const headerIdx = lines.findIndex((l) => l.trim() === OSTACKY_GITIGNORE_HEADER);
  if (headerIdx !== -1) {
    let insertIdx = headerIdx + 1;
    while (insertIdx < lines.length && (OSTACKY_GITIGNORE_PATTERNS.some((p) => lines[insertIdx].trim() === p) || lines[insertIdx].trim() === "")) {
      insertIdx++;
    }
    lines.splice(insertIdx, 0, ...missingPatterns);
    const newContent = lines.join(`
`);
    const finalContent = newContent.endsWith(`
`) ? newContent : newContent + `
`;
    writeFileSync(gitignorePath, finalContent, "utf-8");
    patternsAdded.push(...missingPatterns);
    updated = true;
  } else {
    const newContent = raw.endsWith(`
`) ? raw + missingPatterns.join(`
`) + `
` : raw + `
` + missingPatterns.join(`
`) + `
`;
    writeFileSync(gitignorePath, newContent, "utf-8");
    patternsAdded.push(...missingPatterns);
    updated = true;
  }
  return { created, updated, patternsAdded };
}
var USER_AGENT = "ostacky-installer", OSTACKY_GITIGNORE_PATTERNS, OSTACKY_GITIGNORE_HEADER = "# Ostacky";
var init_fs = __esm(() => {
  init_security();
  OSTACKY_GITIGNORE_PATTERNS = [
    ".opencode/tools/",
    ".opencode/cache/",
    ".opencode/ostacky-state.json",
    ".opencode/ostacky-state.json.backup*",
    ".opencode/ostacky-state.json.lock.*",
    ".opencode/ostacky-audit.jsonl",
    ".codegraph/",
    "openspec/"
  ];
});

// manifest.json
var manifest_default;
var init_manifest = __esm(() => {
  manifest_default = {
    version: "0.8.8",
    repo: "JaimeHoracio/Ostacky",
    tag: "v0.8.8",
    agents: [
      {
        name: "ostacky",
        file: "assets/agents/ostacky.md",
        description: "Orquestador con recuperación automática (nunca se congela), ruteo por nivel de impacto, controller MCP con SDK oficial, edición segura con fallback inline, y delegación en OpenSpec + Superpowers. v0.8.8: prune de skills obsoletas, lastHandoff, getAvailableTransitions, consecutiveFailures real, mem_session_summary automático al cierre.",
        version: "0.8.8",
        sha256: "191a317be68bde517f6d3877ec3a016720617d7382944fff0d08d31b985a6644"
      }
    ],
    commands: [
      {
        name: "install-stack",
        file: "assets/commands/install-stack.md",
        description: "Instala el stack tecnológico del proyecto (CodeGraph, skills, OpenSpec, Engram, controller plugin). v0.8.8: controller plugin como alma hard-gate, Context7 removido del stack.",
        version: "0.8.8",
        sha256: "315d8fcdf2a945cef863bb4576838f95d7eb4a0acca38c12575dc80ecc4724dc"
      },
      {
        name: "opsx-sync",
        file: "assets/commands/opsx-sync.md",
        description: "Sincroniza delta specs del change activo sin inicializar CodeGraph si ya existe índice",
        version: "0.8.8",
        sha256: "fe0158478f2ca63b315037a85fc1632b77868532e319af6c7384285441767d64"
      }
    ],
    mcpServers: [
      {
        name: "ostacky-controller",
        file: "assets/mcp/ostacky-controller/",
        description: "Máquina de estados persistida con @modelcontextprotocol/server SDK. v0.8.8: 22 tools (incluye set_handoff, get_handoff, clear_handoff, get_available_transitions funcional). Bugfixes: consecutiveFailures real, lastHandoff state, defaultChoice persistido. Robustez: degraded mode automático tras 3 fallos, persistence condicional para Nivel 0, prune de skills obsoletas.",
        version: "0.8.8",
        sha256: "34c7b4bd6ba42ec0da21ef2fd6fededa47d11d3752a17fc6e153e983900930d2"
      },
      {
        name: "openspec",
        file: "assets/mcp/openspec/",
        description: "MCP server local para OpenSpec - proposal, apply, archive, sync de cambios",
        version: "0.8.8",
        sha256: "fa4be28bfc1e75db8f1a037e2580f04a60066c80e8e5934e90e1041020d04609"
      }
    ],
    skills: [
      {
        name: "brainstorming",
        file: "assets/skills/brainstorming/SKILL.md",
        description: "Skill unificado de pensamiento con dos modos: creative-design (producción de diseño → transición a implementación directa o openspec-propose) y open-exploration (exploración libre)",
        version: "0.8.8",
        sha256: "f1013a86a8f27914d85a716e23c7fd32db1786d93615e8b0834b13d184308549"
      },
      {
        name: "execution-mode-evaluation",
        file: "assets/skills/execution-mode-evaluation/SKILL.md",
        description: "Skill de análisis de modo de ejecución — output reconciliado con controller snapshot contract (recommendation field)",
        version: "0.8.8",
        sha256: "2158a6864c0912e868a9d720db7fd79441e6cc298e3320833d2527c9727c852e"
      },
      {
        name: "tdd",
        file: "assets/skills/tdd/SKILL.md",
        description: "Skill de test-driven development (Superpowers)",
        version: "0.8.8",
        sha256: "f0ebfbbc43a8868d31a3fd2df37ae7f60fe8add09c6475862395a68269e5ff7f"
      },
      {
        name: "subagent-driven-development",
        file: "assets/skills/subagent-driven-development/SKILL.md",
        description: "Skill de ejecución con subagentes (Superpowers) — ejecuta solo después de confirmación del coordinador Ostacky",
        version: "0.8.8",
        sha256: "1a42d714a9a13faf05f0bf7b580e8d837c2e77a5633839542ccce603023419e8"
      },
      {
        name: "dispatching-parallel-agents",
        file: "assets/skills/dispatching-parallel-agents/SKILL.md",
        description: "Skill de dispatch paralelo de agentes (Superpowers)",
        version: "0.8.8",
        sha256: "7e7b712ef742d5631e302e6a71583e2bbbd33094da9281abfb84b43505fc3ef1"
      },
      {
        name: "review",
        file: "assets/skills/review/SKILL.md",
        description: "Skill de revisión de código (Superpowers)",
        version: "0.8.8",
        sha256: "b19650ed4d1d4d9857a4dd5b7e08e91328a1a1fc9c45bcc2fb600fa9d0213279"
      },
      {
        name: "receiving-code-review",
        file: "assets/skills/receiving-code-review/SKILL.md",
        description: "Skill de recibir y procesar feedback de code review",
        version: "0.8.8",
        sha256: "d761e884e71d8d3476ac734d287cae403a4024506a7d12e7361a448217c0a831"
      },
      {
        name: "openspec-propose",
        file: "assets/skills/openspec-propose/SKILL.md",
        description: "Skill de generación de proposal (OpenSpec)",
        version: "0.8.8",
        sha256: "6a517f750f24c008208156a2d653e97ed30b1e53878aeac5ce394e573db0678f"
      },
      {
        name: "openspec-apply-change",
        file: "assets/skills/openspec-apply-change/SKILL.md",
        description: "Skill de aplicación de change (OpenSpec)",
        version: "0.8.8",
        sha256: "dfc823bf89fc7505e91ab6dee9c1f004be38a410bd3d88fb67b211b1b6cbb1d0"
      },
      {
        name: "openspec-archive-change",
        file: "assets/skills/openspec-archive-change/SKILL.md",
        description: "Skill de archivo de change (OpenSpec)",
        version: "0.8.8",
        sha256: "16e4b561de7747283663fed602e506abf502452c49a8d4b86d7a5539c40f0195"
      },
      {
        name: "openspec-explore",
        file: "assets/skills/openspec-explore/SKILL.md",
        description: "Modo explore para OpenSpec — thinking partner para explorar ideas, investigar problemas y clarificar requisitos antes/durante un cambio",
        version: "0.8.8",
        sha256: "9eafc3a8c693b8d9916867ef764d49e5222da717fde501c957bb3f6c312d2415"
      },
      {
        name: "using-git-worktrees",
        file: "assets/skills/using-git-worktrees/SKILL.md",
        description: "Skill de uso de git worktrees para aislamiento de trabajo",
        version: "0.8.8",
        sha256: "93341bc1b7c053618a8b6dc07e3615b77990d7b549a0201f5835d95fef67ce13"
      },
      {
        name: "using-superpowers",
        file: "assets/skills/using-superpowers/SKILL.md",
        description: "Skill de orquestación de Superpowers skills",
        version: "0.8.8",
        sha256: "7e54536f96d2a379185a10bfc1e970850caa2561b6d8aca7080f0defea0381a4"
      },
      {
        name: "writing-skills",
        file: "assets/skills/writing-skills/SKILL.md",
        description: "Skill de creación y edición de skills",
        version: "0.8.8",
        sha256: "3d76b906cee518a2b809febb70db95697a35b9f368986bb504b4120c3bfb437a"
      },
      {
        name: "graceful-degradation",
        file: "assets/skills/graceful-degradation/SKILL.md",
        description: "Skill de degradación graceful cuando múltiples tools están indisponibles",
        version: "0.8.8",
        sha256: "363449bd9e6f800a0a3168667cf78f767fb105d86e4a4adadcc649d418139303"
      }
    ]
  };
});

// src/cache.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2, dirname as dirname2 } from "path";
function getCacheRoot(projectRoot) {
  return join2(projectRoot, ".opencode", "cache");
}
function cacheKey(projectRoot, repo, tag, filePath) {
  const repoSlug = repo.replace("/", "__");
  return join2(getCacheRoot(projectRoot), repoSlug, tag, filePath);
}
function getCached(projectRoot, repo, tag, filePath, expectedHash) {
  const cachePath = cacheKey(projectRoot, repo, tag, filePath);
  if (!existsSync2(cachePath))
    return null;
  try {
    const content = readFileSync2(cachePath, "utf-8");
    if (expectedHash && sha256(content) !== expectedHash)
      return null;
    return content;
  } catch {
    return null;
  }
}
function putCache(projectRoot, repo, tag, filePath, content) {
  const cachePath = cacheKey(projectRoot, repo, tag, filePath);
  const dir = dirname2(cachePath);
  if (!existsSync2(dir))
    mkdirSync2(dir, { recursive: true });
  writeFileSync2(cachePath, content, "utf-8");
}
var init_cache = __esm(() => {
  init_security();
});

// src/github.ts
import { fileURLToPath } from "url";
import { dirname as dirname3, join as join3 } from "path";
function getBundledSkillPath(name) {
  validateFilePath(name);
  return join3(BUNDLED_SKILLS_DIR, name);
}
function getBundledMcpPath(name) {
  validateFilePath(name);
  return join3(BUNDLED_MCP_DIR, name);
}
function getRawUrl(repo, tag, path) {
  return `${GITHUB_RAW}/${repo}/${tag}/${path}`;
}
async function fetchLatestReleaseTag(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT }
    });
    if (res.ok) {
      const data = await res.json();
      return data.tag_name ?? null;
    }
  } catch {}
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT }
    });
    const loc = res.headers.get("location") ?? "";
    const m = loc.match(/releases\/tag\/(v[^/]+)$/);
    if (m)
      return m[1];
  } catch {}
  return null;
}
async function fetchManifest(tag) {
  const resolvedTag = tag ?? manifest_default.tag;
  try {
    const url = getRawUrl(manifest_default.repo, resolvedTag, "manifest.json");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": USER_AGENT }
    });
    if (response.ok) {
      return await response.json();
    }
  } catch {}
  return manifest_default;
}
async function fetchLatestManifest() {
  const latestTag = await fetchLatestReleaseTag(manifest_default.repo);
  const currentTag = manifest_default.tag;
  const isNew = latestTag !== null && latestTag !== currentTag;
  const manifest = await fetchManifest(latestTag ?? currentTag);
  return { manifest, isNew, latestTag };
}
async function downloadFile(manifest, filePath) {
  validateFilePath(filePath);
  const item = [
    ...manifest.agents,
    ...manifest.commands,
    ...manifest.skills ?? [],
    ...manifest.mcpServers ?? []
  ].find((i) => i.file === filePath);
  const expectedHash = item?.sha256 ?? null;
  const projectRoot = findProjectRoot();
  const cached = getCached(projectRoot, manifest.repo, manifest.tag, filePath, expectedHash);
  if (cached !== null)
    return cached;
  const url = getRawUrl(manifest.repo, manifest.tag, filePath);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`Error descargando ${url}: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  verifyChecksum(content, expectedHash, filePath);
  putCache(projectRoot, manifest.repo, manifest.tag, filePath, content);
  return content;
}
var GITHUB_RAW = "https://raw.githubusercontent.com", __filename2, __dirname2, PACKAGE_ROOT, BUNDLED_SKILLS_DIR, BUNDLED_MCP_DIR;
var init_github = __esm(() => {
  init_manifest();
  init_cache();
  init_security();
  init_fs();
  __filename2 = fileURLToPath(import.meta.url);
  __dirname2 = dirname3(__filename2);
  PACKAGE_ROOT = join3(__dirname2, "..");
  BUNDLED_SKILLS_DIR = join3(PACKAGE_ROOT, "assets", "skills");
  BUNDLED_MCP_DIR = join3(PACKAGE_ROOT, "assets", "mcp");
});

// src/lockfile.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "fs";
import { join as join4 } from "path";
function getLockfilePath(opencodeRoot) {
  return join4(opencodeRoot, LOCKFILE_NAME);
}
function readLockfile(opencodeRoot) {
  const lockPath = getLockfilePath(opencodeRoot);
  if (!existsSync3(lockPath))
    return null;
  try {
    return JSON.parse(readFileSync3(lockPath, "utf-8"));
  } catch {
    return null;
  }
}
function writeLockfile(opencodeRoot, lockfile) {
  writeFileSync3(getLockfilePath(opencodeRoot), JSON.stringify(lockfile, null, 2), "utf-8");
}
function getInstalledVersion(lockfile, type, name) {
  return lockfile?.[type]?.[name]?.version ?? null;
}
function removeFromLockfile(opencodeRoot, type, name) {
  const lockfile = readLockfile(opencodeRoot);
  if (!lockfile)
    return;
  if (!lockfile[type])
    return;
  if (!(name in lockfile[type]))
    return;
  delete lockfile[type][name];
  writeLockfile(opencodeRoot, lockfile);
}
function clearLockfile(opencodeRoot) {
  const lockfile = readLockfile(opencodeRoot);
  if (!lockfile) {
    writeLockfile(opencodeRoot, {
      version: LOCKFILE_VERSION,
      lockedAt: new Date().toISOString(),
      repo: "",
      tag: "",
      agents: {},
      commands: {},
      skills: {},
      mcpServers: {}
    });
    return;
  }
  lockfile.agents = {};
  lockfile.commands = {};
  lockfile.skills = {};
  lockfile.mcpServers = {};
  lockfile.lockedAt = new Date().toISOString();
  writeLockfile(opencodeRoot, lockfile);
}
var LOCKFILE_NAME = "ostacky-lock.json", LOCKFILE_VERSION;
var init_lockfile = __esm(() => {
  init_manifest();
  LOCKFILE_VERSION = manifest_default.version;
});

// src/config.ts
import { existsSync as existsSync4, readFileSync as readFileSync4, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "fs";
import { join as join5 } from "path";
function stripJsoncComments(text) {
  let result = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      if (char === "\\") {
        result += char + (next ?? "");
        i += 2;
        continue;
      }
      if (char === '"')
        inString = false;
      result += char;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      i++;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== `
`)
        i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    result += char;
    i++;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}
function readOpenCodeConfig(configPath) {
  const raw = readFileSync4(configPath, "utf-8");
  try {
    return JSON.parse(stripJsoncComments(raw));
  } catch {
    return null;
  }
}
function writeOpenCodeConfig(configPath, config) {
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync4(tmpPath, JSON.stringify(config, null, 2) + `
`, "utf-8");
    renameSync2(tmpPath, configPath);
  } finally {
    if (existsSync4(tmpPath))
      rmSync2(tmpPath, { force: true });
  }
}
function ensureOpenCodeConfig(projectRoot) {
  const existing = findOpenCodeConfig(projectRoot);
  if (existing)
    return existing;
  const configPath = join5(projectRoot, "opencode.json");
  writeOpenCodeConfig(configPath, {
    $schema: "https://opencode.ai/config.json",
    mcp: {}
  });
  return configPath;
}
function findOpenCodeConfig(projectRoot) {
  const candidates = ["opencode.json", "opencode.jsonc"];
  for (const name of candidates) {
    const full = join5(projectRoot, name);
    if (existsSync4(full))
      return full;
  }
  return null;
}
function setMcpEntryAtProjectRoot(projectRoot, name, entry) {
  const configPath = ensureOpenCodeConfig(projectRoot);
  const config = readOpenCodeConfig(configPath);
  if (!config)
    throw new Error(`Error parseando ${configPath}`);
  if (!config.mcp)
    config.mcp = {};
  config.mcp[name] = entry;
  writeOpenCodeConfig(configPath, config);
}
function patchOpenCodeConfig(projectRoot = findProjectRoot()) {
  const configPath = findOpenCodeConfig(projectRoot);
  if (!configPath) {
    return {
      success: false,
      message: "No se encontró opencode.json ni opencode.jsonc"
    };
  }
  const config = readOpenCodeConfig(configPath);
  if (!config) {
    return {
      success: false,
      message: `Error parseando ${configPath}`
    };
  }
  let changed = false;
  if ("plugin" in config) {
    delete config.plugin;
    changed = true;
  }
  if (changed) {
    writeOpenCodeConfig(configPath, config);
    return { success: true, message: "Config actualizada (plugin legacy eliminado)" };
  }
  return { success: true, message: "Config de OpenCode ya está limpia" };
}
var init_config = __esm(() => {
  init_fs();
});

// src/stack.ts
import { chmodSync, copyFileSync as copyFileSync3, existsSync as existsSync6, mkdirSync as mkdirSync4, rmSync as rmSync4, unlinkSync as unlinkSync3 } from "fs";
import { basename as basename2, dirname as dirname5, join as join7, resolve as resolve2 } from "path";
import { execFileSync as execFileSync3 } from "child_process";
function resolveToolInstallLocation(toolsDir) {
  const resolvedToolsDir = resolve2(toolsDir ?? join7(findProjectRoot(), ".opencode", "tools"));
  const possibleOpenCodeDir = dirname5(resolvedToolsDir);
  return {
    projectRoot: basename2(possibleOpenCodeDir) === ".opencode" ? dirname5(possibleOpenCodeDir) : findProjectRoot(),
    toolsDir: resolvedToolsDir
  };
}
function runTool(binary, args, cwd, timeout = 30000) {
  const invocation = getCommandInvocation(binary, args);
  try {
    execFileSync3(invocation.command, invocation.args, {
      cwd,
      stdio: "pipe",
      timeout
    });
  } catch (error) {
    const err = error;
    const stdout = err.stdout ? Buffer.from(err.stdout).toString().trim() : "";
    const stderr = err.stderr ? Buffer.from(err.stderr).toString().trim() : "";
    const detail = [stderr, stdout].filter(Boolean).join(`
`) || err.message;
    const invocationStr = `${invocation.command} ${invocation.args.join(" ")}`;
    throw new Error(`${detail} (invocación: ${invocationStr}, cwd: ${cwd ?? process.cwd()})`);
  }
}
function findToolBinary(toolDir, name) {
  const binDir = join7(toolDir, "bin");
  for (const executable of getExecutableNames(name)) {
    const candidate = join7(binDir, executable);
    if (existsSync6(candidate))
      return candidate;
  }
  return findBinaryInDir(toolDir, name);
}
function configureLocalTool(projectRoot, name, command) {
  setMcpEntryAtProjectRoot(projectRoot, name, {
    type: "local",
    command,
    enabled: true
  });
}
function buildLocalMcpCommand(executable, args, platform = process.platform) {
  const invocation = getCommandInvocation(executable, args, platform);
  return [invocation.command, ...invocation.args];
}
function copyEngramPlugin(projectRoot) {
  const pluginSource = join7(PACKAGE_ROOT, "assets", "plugins", "engram.ts");
  const pluginsDir = join7(projectRoot, ".opencode", "plugins");
  if (!existsSync6(pluginSource)) {
    throw new Error(`Plugin bundleado de Engram no encontrado: ${pluginSource}`);
  }
  mkdirSync4(pluginsDir, { recursive: true });
  copyFileSync3(pluginSource, join7(pluginsDir, "engram.ts"));
}
function copyOstackyControllerPlugin(projectRoot) {
  const pluginSource = join7(PACKAGE_ROOT, "assets", "plugins", "ostacky-plugin.ts");
  const coreSource = join7(PACKAGE_ROOT, "assets", "plugins", "controller-core.ts");
  const securitySource = join7(PACKAGE_ROOT, "assets", "plugins", "security.ts");
  const tieredSource = join7(PACKAGE_ROOT, "assets", "plugins", "tiered.ts");
  const pluginsDir = join7(projectRoot, ".opencode", "plugins");
  if (!existsSync6(pluginSource)) {
    throw new Error(`Plugin bundleado de OstackyController no encontrado: ${pluginSource}`);
  }
  mkdirSync4(pluginsDir, { recursive: true });
  copyFileSync3(pluginSource, join7(pluginsDir, "ostacky-plugin.ts"));
  if (existsSync6(coreSource))
    copyFileSync3(coreSource, join7(pluginsDir, "controller-core.ts"));
  if (existsSync6(securitySource))
    copyFileSync3(securitySource, join7(pluginsDir, "security.ts"));
  if (existsSync6(tieredSource))
    copyFileSync3(tieredSource, join7(pluginsDir, "tiered.ts"));
}
function buildEngramDownloadUrl(tag, platform = process.platform, arch = process.arch) {
  const target = getEngramReleaseTarget(platform, arch);
  if (!target)
    return null;
  const extension = platform === "win32" ? "zip" : "tar.gz";
  return `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${tag.replace(/^v/, "")}_${target.replace("-", "_")}.${extension}`;
}
async function installCodeGraph(toolsDir) {
  const location = resolveToolInstallLocation(toolsDir);
  const { projectRoot } = location;
  const cgToolDir = join7(location.toolsDir, "codegraph");
  if (!existsSync6(cgToolDir))
    mkdirSync4(cgToolDir, { recursive: true });
  const target = detectPlatformTarget();
  if (!target) {
    return {
      success: false,
      message: `Plataforma no soportada para descarga local: ${process.platform}/${process.arch}. Instalá CodeGraph manualmente.`
    };
  }
  let localBin = findToolBinary(cgToolDir, "codegraph");
  let archivePromotion = null;
  const failAfterExtraction = (message) => {
    try {
      archivePromotion?.rollback();
    } catch {}
    return { success: false, message };
  };
  if (localBin) {
    try {
      runTool(localBin, ["--version"], projectRoot, 1e4);
    } catch {
      try {
        rmSync4(cgToolDir, { recursive: true, force: true });
      } catch {}
      localBin = null;
    }
  }
  if (!localBin) {
    const tag = await fetchLatestReleaseTag("colbymchenry/codegraph");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de CodeGraph desde GitHub."
      };
    }
    const ext = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/codegraph-${target}.${ext}`;
    try {
      archivePromotion = await downloadAndExtractWithRetry(url, cgToolDir, 1, 180000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando CodeGraph ${tag}: ${e.message}`
      };
    }
    const expectedBin = join7(cgToolDir, "bin", getExecutableName("codegraph"));
    let found = findToolBinary(cgToolDir, "codegraph");
    if (!found)
      found = findBinaryInDir(cgToolDir, "codegraph");
    if (!found) {
      return failAfterExtraction(`Descarga de CodeGraph ${tag} completada pero no se encontró el binario en ${join7(cgToolDir, "bin")}.`);
    }
    try {
      if (found !== expectedBin) {
        mkdirSync4(join7(cgToolDir, "bin"), { recursive: true });
        if (found.toLowerCase().endsWith(".cmd") && expectedBin.toLowerCase().endsWith(".exe")) {
          localBin = found;
        } else {
          copyFileSync3(found, expectedBin);
          localBin = expectedBin;
        }
      } else {
        localBin = found;
      }
    } catch (error) {
      return failAfterExtraction(`CodeGraph fue descargado pero no se pudo materializar el binario local: ${error.message}`);
    }
    if (process.platform !== "win32" && localBin) {
      try {
        chmodSync(localBin, 493);
      } catch {}
    }
  }
  try {
    runTool(localBin, ["--version"], projectRoot, 1e4);
  } catch (error) {
    return failAfterExtraction(`CodeGraph fue extraído pero no se puede ejecutar: ${error.message}`);
  }
  let indexWarning = null;
  try {
    runTool(localBin, ["init", "-i"], projectRoot, 120000);
  } catch (error) {
    const msg = error.message;
    indexWarning = `El índice no se pudo inicializar todavía: ${msg}. Sugerencia: ejecutá manualmente \`${localBin} init -i\` en ${projectRoot} o \`npx ostacky install-stack --scope local\` para reintentar. Si el path del binario (${localBin}) apunta a ${cgToolDir} y esperabas otro proyecto, verificá que corriste el comando dentro del proyecto correcto (con .git) y con --scope local.`;
  }
  try {
    configureLocalTool(projectRoot, "codegraph", buildLocalMcpCommand(localBin, ["serve", "--mcp"]));
  } catch (error) {
    return failAfterExtraction(`CodeGraph fue instalado pero no se pudo configurar el MCP: ${error.message}`);
  }
  archivePromotion?.commit();
  return {
    success: true,
    message: indexWarning ? `CodeGraph instalado y configurado para OpenCode. ${indexWarning}` : "CodeGraph instalado localmente y configurado para OpenCode"
  };
}
function setupOpenSpec(projectRoot = findProjectRoot()) {
  const useBun = isCommandAvailable("bun");
  const fail = (msg) => ({ success: false, message: msg });
  const tryDirect = () => {
    try {
      const invocation = getCommandInvocation(useBun ? "bunx" : "npx", useBun ? [OPENSPEC_NPM_PACKAGE, "init", "--tools", "opencode", "--force"] : ["--yes", OPENSPEC_NPM_PACKAGE, "init", "--tools", "opencode", "--force"]);
      execFileSync3(invocation.command, invocation.args, {
        stdio: "pipe",
        timeout: 120000,
        cwd: projectRoot
      });
      return true;
    } catch {
      return false;
    }
  };
  const tryInstallGlobal = () => {
    if (!useBun && !isCommandAvailable("npm")) {
      return { ok: false, error: "Ni bun ni npm están disponibles para instalar OpenSpec globalmente" };
    }
    const pkgManager = useBun ? "bun" : "npm";
    const installArgs = useBun ? ["add", "-g", OPENSPEC_NPM_PACKAGE] : ["install", "-g", OPENSPEC_NPM_PACKAGE];
    try {
      const invocation = getCommandInvocation(pkgManager, installArgs);
      execFileSync3(invocation.command, invocation.args, { stdio: "pipe", timeout: 120000 });
    } catch (installErr) {
      return { ok: false, error: `Instalación global falló: ${installErr.message}` };
    }
    try {
      const retryInvocation = getCommandInvocation("openspec", ["init", "--tools", "opencode", "--force"]);
      execFileSync3(retryInvocation.command, retryInvocation.args, {
        stdio: "pipe",
        timeout: 120000,
        cwd: projectRoot
      });
      return { ok: true };
    } catch (retryErr) {
      return { ok: false, error: `Reintento con binario global falló: ${retryErr.message}` };
    }
  };
  if (tryDirect()) {
    return { success: true, message: "OpenSpec configurado para OpenCode" };
  }
  const fallback = tryInstallGlobal();
  if (fallback.ok) {
    return {
      success: true,
      message: `OpenSpec configurado para OpenCode (binario instalado globalmente con ${useBun ? "bun" : "npm"})`
    };
  }
  const manualCmd = useBun ? `bun add -g ${OPENSPEC_NPM_PACKAGE}` : `npm install -g ${OPENSPEC_NPM_PACKAGE}`;
  return fail(`Error configurando OpenSpec: ni bunx/npx ni la instalación global resolvieron el binario. ` + `Solución manual: ejecuta \`${manualCmd}\` y luego corré /install-stack de nuevo. ` + `Detalle: ${fallback.error}`);
}
async function installEngram(toolsDir) {
  const location = resolveToolInstallLocation(toolsDir);
  const { projectRoot } = location;
  const engramToolDir = join7(location.toolsDir, "engram");
  const engramBinDir = join7(engramToolDir, "bin");
  if (!existsSync6(engramBinDir))
    mkdirSync4(engramBinDir, { recursive: true });
  const localBin = join7(engramBinDir, getExecutableName("engram"));
  let archivePromotion = null;
  const failAfterExtraction = (message) => {
    try {
      archivePromotion?.rollback();
    } catch {}
    return { success: false, message };
  };
  if (existsSync6(localBin)) {
    try {
      runTool(localBin, ["--version"], projectRoot, 1e4);
    } catch {
      try {
        unlinkSync3(localBin);
      } catch {}
    }
  }
  if (!existsSync6(localBin)) {
    const globalBin = findExecutablePath("engram");
    const useGlobalBinary = globalBin && (process.platform !== "win32" || globalBin.toLowerCase().endsWith(".exe"));
    if (useGlobalBinary) {
      try {
        runTool(globalBin, ["--version"], projectRoot, 1e4);
        mkdirSync4(engramBinDir, { recursive: true });
        copyFileSync3(globalBin, localBin);
      } catch {
        try {
          unlinkSync3(localBin);
        } catch {}
      }
    }
  }
  if (!existsSync6(localBin)) {
    const tag = await fetchLatestReleaseTag("Gentleman-Programming/engram");
    if (!tag) {
      return {
        success: false,
        message: "No se pudo obtener la última versión de Engram desde GitHub."
      };
    }
    const url = buildEngramDownloadUrl(tag);
    if (!url) {
      return {
        success: false,
        message: `Plataforma no soportada para descargar Engram: ${process.platform}/${process.arch}.`
      };
    }
    try {
      archivePromotion = await downloadAndExtractWithRetry(url, engramToolDir, 0, 120000, 2);
    } catch (e) {
      return {
        success: false,
        message: `Error descargando Engram ${tag}: ${e.message}`
      };
    }
    mkdirSync4(engramBinDir, { recursive: true });
    const found = findBinaryInDir(engramToolDir, "engram");
    if (!found) {
      return failAfterExtraction(`Descarga de Engram ${tag} completada pero no se encontró el binario en ${localBin}.`);
    }
    try {
      if (found !== localBin)
        copyFileSync3(found, localBin);
    } catch (error) {
      return failAfterExtraction(`Engram fue descargado pero no se pudo materializar el binario local: ${error.message}`);
    }
    if (process.platform !== "win32") {
      try {
        chmodSync(localBin, 493);
      } catch {}
    }
  }
  try {
    runTool(localBin, ["--version"], projectRoot, 1e4);
    copyEngramPlugin(projectRoot);
    copyOstackyControllerPlugin(projectRoot);
    configureLocalTool(projectRoot, "engram", buildLocalMcpCommand(localBin, ["mcp"]));
  } catch (error) {
    return failAfterExtraction(`Engram fue instalado pero no se pudo verificar o configurar: ${error.message}`);
  }
  archivePromotion?.commit();
  return { success: true, message: "Engram instalado localmente y configurado para OpenCode (MCP + plugin)" };
}
function uninstallEngramConfig() {
  const projectRoot = findProjectRoot();
  const configPath = findOpenCodeConfig(projectRoot);
  if (!configPath) {
    return { success: false, message: "No se encontró opencode.json ni opencode.jsonc" };
  }
  const config = readOpenCodeConfig(configPath);
  if (!config) {
    return { success: false, message: `Error parseando ${configPath}` };
  }
  const mcp = config.mcp;
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
function uninstallStackConfig(paths) {
  const projectRoot = dirname5(paths.root);
  const removed = [];
  const configPath = findOpenCodeConfig(projectRoot);
  if (configPath) {
    const config = readOpenCodeConfig(configPath);
    if (config) {
      const mcp = config.mcp;
      let changed = false;
      if (mcp) {
        for (const name of ["codegraph", "engram"]) {
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
  const codegraphDir = join7(projectRoot, ".codegraph");
  if (existsSync6(codegraphDir)) {
    try {
      rmSync4(codegraphDir, { recursive: true, force: true });
      removed.push(".codegraph/");
    } catch {}
  }
  if (existsSync6(paths.tools)) {
    try {
      rmSync4(paths.tools, { recursive: true, force: true });
      removed.push(".opencode/tools/");
    } catch {}
  }
  if (removed.length === 0) {
    return { success: true, message: "No había configuración del stack para remover" };
  }
  return {
    success: true,
    message: `Removido: ${removed.join(", ")}. Los binarios globales (codegraph, engram) no se tocaron.`
  };
}
var OPENSPEC_NPM_PACKAGE = "@fission-ai/openspec";
var init_stack = __esm(() => {
  init_fs();
  init_config();
  init_github();
});
// package.json
var package_default = {
  name: "ostacky",
  version: "0.8.8",
  description: "Instalador interactivo de agentes y comandos para OpenCode",
  type: "module",
  bin: {
    ostacky: "./dist/cli.js"
  },
  scripts: {
    prebuild: "bun run scripts/sync-version.ts && bun run scripts/sync-controller-core.ts",
    dev: "bun run src/cli.ts",
    build: "bun build src/cli.ts --target=node --format=esm --outfile dist/cli.js && bun scripts/add-shebang.ts",
    start: "node dist/cli.js",
    test: "bun test",
    "check:skills": "bun run scripts/check-skill-sync.ts",
    "check:skills:fix": "bun run scripts/check-skill-sync.ts --fix",
    "hash:check": "bun run scripts/update-manifest-hashes.ts --check",
    "hash:update": "bun run scripts/update-manifest-hashes.ts",
    "manifest:prepare": "bun run scripts/update-manifest-hashes.ts",
    "manifest:check": "bun run scripts/update-manifest-hashes.ts --check",
    prepublishOnly: "bun run scripts/sync-controller-core.ts && bun run manifest:prepare && bun run build"
  },
  files: [
    "dist/",
    "assets/",
    "manifest.json",
    "LICENSE"
  ],
  keywords: [
    "opencode",
    "installer",
    "cli",
    "agent"
  ],
  license: "MIT",
  dependencies: {
    "@clack/prompts": "^0.9.0"
  },
  devDependencies: {
    "@types/bun": "latest",
    typescript: "^5.0.0"
  },
  publishConfig: {
    access: "public"
  },
  engines: {
    node: ">=20.0.0"
  }
};

// node_modules/@clack/prompts/dist/index.mjs
var exports_dist = {};
__export(exports_dist, {
  cancel: () => ve,
  confirm: () => me,
  group: () => be,
  groupMultiselect: () => ge,
  intro: () => we,
  isCancel: () => BD,
  log: () => v2,
  multiselect: () => pe,
  note: () => ye,
  outro: () => fe,
  password: () => $e,
  select: () => de,
  selectKey: () => he,
  spinner: () => L2,
  tasks: () => xe,
  text: () => ue,
  updateSettings: () => hD
});
import { stripVTControlCharacters as T2 } from "node:util";

// node_modules/@clack/core/dist/index.mjs
var import_sisteransi = __toESM(require_src(), 1);
var import_picocolors = __toESM(require_picocolors(), 1);
import { stdin as $, stdout as j } from "node:process";
import * as f from "node:readline";
import M from "node:readline";
import { WriteStream as U } from "node:tty";
function J({ onlyFirst: t = false } = {}) {
  const F = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
  return new RegExp(F, t ? undefined : "g");
}
var Q = J();
function T(t) {
  if (typeof t != "string")
    throw new TypeError(`Expected a \`string\`, got \`${typeof t}\``);
  return t.replace(Q, "");
}
function O(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var P = { exports: {} };
(function(t) {
  var u = {};
  t.exports = u, u.eastAsianWidth = function(e) {
    var s = e.charCodeAt(0), i = e.length == 2 ? e.charCodeAt(1) : 0, D = s;
    return 55296 <= s && s <= 56319 && 56320 <= i && i <= 57343 && (s &= 1023, i &= 1023, D = s << 10 | i, D += 65536), D == 12288 || 65281 <= D && D <= 65376 || 65504 <= D && D <= 65510 ? "F" : D == 8361 || 65377 <= D && D <= 65470 || 65474 <= D && D <= 65479 || 65482 <= D && D <= 65487 || 65490 <= D && D <= 65495 || 65498 <= D && D <= 65500 || 65512 <= D && D <= 65518 ? "H" : 4352 <= D && D <= 4447 || 4515 <= D && D <= 4519 || 4602 <= D && D <= 4607 || 9001 <= D && D <= 9002 || 11904 <= D && D <= 11929 || 11931 <= D && D <= 12019 || 12032 <= D && D <= 12245 || 12272 <= D && D <= 12283 || 12289 <= D && D <= 12350 || 12353 <= D && D <= 12438 || 12441 <= D && D <= 12543 || 12549 <= D && D <= 12589 || 12593 <= D && D <= 12686 || 12688 <= D && D <= 12730 || 12736 <= D && D <= 12771 || 12784 <= D && D <= 12830 || 12832 <= D && D <= 12871 || 12880 <= D && D <= 13054 || 13056 <= D && D <= 19903 || 19968 <= D && D <= 42124 || 42128 <= D && D <= 42182 || 43360 <= D && D <= 43388 || 44032 <= D && D <= 55203 || 55216 <= D && D <= 55238 || 55243 <= D && D <= 55291 || 63744 <= D && D <= 64255 || 65040 <= D && D <= 65049 || 65072 <= D && D <= 65106 || 65108 <= D && D <= 65126 || 65128 <= D && D <= 65131 || 110592 <= D && D <= 110593 || 127488 <= D && D <= 127490 || 127504 <= D && D <= 127546 || 127552 <= D && D <= 127560 || 127568 <= D && D <= 127569 || 131072 <= D && D <= 194367 || 177984 <= D && D <= 196605 || 196608 <= D && D <= 262141 ? "W" : 32 <= D && D <= 126 || 162 <= D && D <= 163 || 165 <= D && D <= 166 || D == 172 || D == 175 || 10214 <= D && D <= 10221 || 10629 <= D && D <= 10630 ? "Na" : D == 161 || D == 164 || 167 <= D && D <= 168 || D == 170 || 173 <= D && D <= 174 || 176 <= D && D <= 180 || 182 <= D && D <= 186 || 188 <= D && D <= 191 || D == 198 || D == 208 || 215 <= D && D <= 216 || 222 <= D && D <= 225 || D == 230 || 232 <= D && D <= 234 || 236 <= D && D <= 237 || D == 240 || 242 <= D && D <= 243 || 247 <= D && D <= 250 || D == 252 || D == 254 || D == 257 || D == 273 || D == 275 || D == 283 || 294 <= D && D <= 295 || D == 299 || 305 <= D && D <= 307 || D == 312 || 319 <= D && D <= 322 || D == 324 || 328 <= D && D <= 331 || D == 333 || 338 <= D && D <= 339 || 358 <= D && D <= 359 || D == 363 || D == 462 || D == 464 || D == 466 || D == 468 || D == 470 || D == 472 || D == 474 || D == 476 || D == 593 || D == 609 || D == 708 || D == 711 || 713 <= D && D <= 715 || D == 717 || D == 720 || 728 <= D && D <= 731 || D == 733 || D == 735 || 768 <= D && D <= 879 || 913 <= D && D <= 929 || 931 <= D && D <= 937 || 945 <= D && D <= 961 || 963 <= D && D <= 969 || D == 1025 || 1040 <= D && D <= 1103 || D == 1105 || D == 8208 || 8211 <= D && D <= 8214 || 8216 <= D && D <= 8217 || 8220 <= D && D <= 8221 || 8224 <= D && D <= 8226 || 8228 <= D && D <= 8231 || D == 8240 || 8242 <= D && D <= 8243 || D == 8245 || D == 8251 || D == 8254 || D == 8308 || D == 8319 || 8321 <= D && D <= 8324 || D == 8364 || D == 8451 || D == 8453 || D == 8457 || D == 8467 || D == 8470 || 8481 <= D && D <= 8482 || D == 8486 || D == 8491 || 8531 <= D && D <= 8532 || 8539 <= D && D <= 8542 || 8544 <= D && D <= 8555 || 8560 <= D && D <= 8569 || D == 8585 || 8592 <= D && D <= 8601 || 8632 <= D && D <= 8633 || D == 8658 || D == 8660 || D == 8679 || D == 8704 || 8706 <= D && D <= 8707 || 8711 <= D && D <= 8712 || D == 8715 || D == 8719 || D == 8721 || D == 8725 || D == 8730 || 8733 <= D && D <= 8736 || D == 8739 || D == 8741 || 8743 <= D && D <= 8748 || D == 8750 || 8756 <= D && D <= 8759 || 8764 <= D && D <= 8765 || D == 8776 || D == 8780 || D == 8786 || 8800 <= D && D <= 8801 || 8804 <= D && D <= 8807 || 8810 <= D && D <= 8811 || 8814 <= D && D <= 8815 || 8834 <= D && D <= 8835 || 8838 <= D && D <= 8839 || D == 8853 || D == 8857 || D == 8869 || D == 8895 || D == 8978 || 9312 <= D && D <= 9449 || 9451 <= D && D <= 9547 || 9552 <= D && D <= 9587 || 9600 <= D && D <= 9615 || 9618 <= D && D <= 9621 || 9632 <= D && D <= 9633 || 9635 <= D && D <= 9641 || 9650 <= D && D <= 9651 || 9654 <= D && D <= 9655 || 9660 <= D && D <= 9661 || 9664 <= D && D <= 9665 || 9670 <= D && D <= 9672 || D == 9675 || 9678 <= D && D <= 9681 || 9698 <= D && D <= 9701 || D == 9711 || 9733 <= D && D <= 9734 || D == 9737 || 9742 <= D && D <= 9743 || 9748 <= D && D <= 9749 || D == 9756 || D == 9758 || D == 9792 || D == 9794 || 9824 <= D && D <= 9825 || 9827 <= D && D <= 9829 || 9831 <= D && D <= 9834 || 9836 <= D && D <= 9837 || D == 9839 || 9886 <= D && D <= 9887 || 9918 <= D && D <= 9919 || 9924 <= D && D <= 9933 || 9935 <= D && D <= 9953 || D == 9955 || 9960 <= D && D <= 9983 || D == 10045 || D == 10071 || 10102 <= D && D <= 10111 || 11093 <= D && D <= 11097 || 12872 <= D && D <= 12879 || 57344 <= D && D <= 63743 || 65024 <= D && D <= 65039 || D == 65533 || 127232 <= D && D <= 127242 || 127248 <= D && D <= 127277 || 127280 <= D && D <= 127337 || 127344 <= D && D <= 127386 || 917760 <= D && D <= 917999 || 983040 <= D && D <= 1048573 || 1048576 <= D && D <= 1114109 ? "A" : "N";
  }, u.characterLength = function(e) {
    var s = this.eastAsianWidth(e);
    return s == "F" || s == "W" || s == "A" ? 2 : 1;
  };
  function F(e) {
    return e.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || [];
  }
  u.length = function(e) {
    for (var s = F(e), i = 0, D = 0;D < s.length; D++)
      i = i + this.characterLength(s[D]);
    return i;
  }, u.slice = function(e, s, i) {
    textLen = u.length(e), s = s || 0, i = i || 1, s < 0 && (s = textLen + s), i < 0 && (i = textLen + i);
    for (var D = "", C = 0, o = F(e), E = 0;E < o.length; E++) {
      var a = o[E], n = u.length(a);
      if (C >= s - (n == 2 ? 1 : 0))
        if (C + n <= i)
          D += a;
        else
          break;
      C += n;
    }
    return D;
  };
})(P);
var X = P.exports;
var DD = O(X);
var uD = function() {
  return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|(?:\uD83E\uDDD1\uD83C\uDFFF\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFC-\uDFFF])|\uD83D\uDC68(?:\uD83C\uDFFB(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|[\u2695\u2696\u2708]\uFE0F|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))?|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])\uFE0F|\u200D(?:(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D[\uDC66\uDC67])|\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC)?|(?:\uD83D\uDC69(?:\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC69(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83E\uDDD1(?:\u200D(?:\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDE36\u200D\uD83C\uDF2B|\uD83C\uDFF3\uFE0F\u200D\u26A7|\uD83D\uDC3B\u200D\u2744|(?:(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\uD83C\uDFF4\u200D\u2620|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])\u200D[\u2640\u2642]|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600-\u2604\u260E\u2611\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u3030\u303D\u3297\u3299]|\uD83C[\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]|\uD83D[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3])\uFE0F|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDE35\u200D\uD83D\uDCAB|\uD83D\uDE2E\u200D\uD83D\uDCA8|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83E\uDDD1(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83D\uDC69(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83D\uDC08\u200D\u2B1B|\u2764\uFE0F\u200D(?:\uD83D\uDD25|\uD83E\uDE79)|\uD83D\uDC41\uFE0F|\uD83C\uDFF3\uFE0F|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|[#\*0-9]\uFE0F\u20E3|\u2764\uFE0F|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|\uD83C\uDFF4|(?:[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270C\u270D]|\uD83D[\uDD74\uDD90])(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC08\uDC15\uDC3B\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE2E\uDE35\uDE36\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5]|\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD]|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF]|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0D\uDD0E\uDD10-\uDD17\uDD1D\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78\uDD7A-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCB\uDDD0\uDDE0-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6]|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26A7\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5-\uDED7\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDD77\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
};
var FD = O(uD);
function A(t, u = {}) {
  if (typeof t != "string" || t.length === 0 || (u = { ambiguousIsNarrow: true, ...u }, t = T(t), t.length === 0))
    return 0;
  t = t.replace(FD(), "  ");
  const F = u.ambiguousIsNarrow ? 1 : 2;
  let e = 0;
  for (const s of t) {
    const i = s.codePointAt(0);
    if (i <= 31 || i >= 127 && i <= 159 || i >= 768 && i <= 879)
      continue;
    switch (DD.eastAsianWidth(s)) {
      case "F":
      case "W":
        e += 2;
        break;
      case "A":
        e += F;
        break;
      default:
        e += 1;
    }
  }
  return e;
}
var m = 10;
var L = (t = 0) => (u) => `\x1B[${u + t}m`;
var N = (t = 0) => (u) => `\x1B[${38 + t};5;${u}m`;
var I = (t = 0) => (u, F, e) => `\x1B[${38 + t};2;${u};${F};${e}m`;
var r = { modifier: { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], overline: [53, 55], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29] }, color: { black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], blackBright: [90, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39] }, bgColor: { bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgBlackBright: [100, 49], bgGray: [100, 49], bgGrey: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49] } };
Object.keys(r.modifier);
var tD = Object.keys(r.color);
var eD = Object.keys(r.bgColor);
[...tD, ...eD];
function sD() {
  const t = new Map;
  for (const [u, F] of Object.entries(r)) {
    for (const [e, s] of Object.entries(F))
      r[e] = { open: `\x1B[${s[0]}m`, close: `\x1B[${s[1]}m` }, F[e] = r[e], t.set(s[0], s[1]);
    Object.defineProperty(r, u, { value: F, enumerable: false });
  }
  return Object.defineProperty(r, "codes", { value: t, enumerable: false }), r.color.close = "\x1B[39m", r.bgColor.close = "\x1B[49m", r.color.ansi = L(), r.color.ansi256 = N(), r.color.ansi16m = I(), r.bgColor.ansi = L(m), r.bgColor.ansi256 = N(m), r.bgColor.ansi16m = I(m), Object.defineProperties(r, { rgbToAnsi256: { value: (u, F, e) => u === F && F === e ? u < 8 ? 16 : u > 248 ? 231 : Math.round((u - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(u / 255 * 5) + 6 * Math.round(F / 255 * 5) + Math.round(e / 255 * 5), enumerable: false }, hexToRgb: { value: (u) => {
    const F = /[a-f\d]{6}|[a-f\d]{3}/i.exec(u.toString(16));
    if (!F)
      return [0, 0, 0];
    let [e] = F;
    e.length === 3 && (e = [...e].map((i) => i + i).join(""));
    const s = Number.parseInt(e, 16);
    return [s >> 16 & 255, s >> 8 & 255, s & 255];
  }, enumerable: false }, hexToAnsi256: { value: (u) => r.rgbToAnsi256(...r.hexToRgb(u)), enumerable: false }, ansi256ToAnsi: { value: (u) => {
    if (u < 8)
      return 30 + u;
    if (u < 16)
      return 90 + (u - 8);
    let F, e, s;
    if (u >= 232)
      F = ((u - 232) * 10 + 8) / 255, e = F, s = F;
    else {
      u -= 16;
      const C = u % 36;
      F = Math.floor(u / 36) / 5, e = Math.floor(C / 6) / 5, s = C % 6 / 5;
    }
    const i = Math.max(F, e, s) * 2;
    if (i === 0)
      return 30;
    let D = 30 + (Math.round(s) << 2 | Math.round(e) << 1 | Math.round(F));
    return i === 2 && (D += 60), D;
  }, enumerable: false }, rgbToAnsi: { value: (u, F, e) => r.ansi256ToAnsi(r.rgbToAnsi256(u, F, e)), enumerable: false }, hexToAnsi: { value: (u) => r.ansi256ToAnsi(r.hexToAnsi256(u)), enumerable: false } }), r;
}
var iD = sD();
var v = new Set(["\x1B", ""]);
var CD = 39;
var w = "\x07";
var W = "[";
var rD = "]";
var R = "m";
var y = `${rD}8;;`;
var V = (t) => `${v.values().next().value}${W}${t}${R}`;
var z = (t) => `${v.values().next().value}${y}${t}${w}`;
var ED = (t) => t.split(" ").map((u) => A(u));
var _ = (t, u, F) => {
  const e = [...u];
  let s = false, i = false, D = A(T(t[t.length - 1]));
  for (const [C, o] of e.entries()) {
    const E = A(o);
    if (D + E <= F ? t[t.length - 1] += o : (t.push(o), D = 0), v.has(o) && (s = true, i = e.slice(C + 1).join("").startsWith(y)), s) {
      i ? o === w && (s = false, i = false) : o === R && (s = false);
      continue;
    }
    D += E, D === F && C < e.length - 1 && (t.push(""), D = 0);
  }
  !D && t[t.length - 1].length > 0 && t.length > 1 && (t[t.length - 2] += t.pop());
};
var nD = (t) => {
  const u = t.split(" ");
  let F = u.length;
  for (;F > 0 && !(A(u[F - 1]) > 0); )
    F--;
  return F === u.length ? t : u.slice(0, F).join(" ") + u.slice(F).join("");
};
var oD = (t, u, F = {}) => {
  if (F.trim !== false && t.trim() === "")
    return "";
  let e = "", s, i;
  const D = ED(t);
  let C = [""];
  for (const [E, a] of t.split(" ").entries()) {
    F.trim !== false && (C[C.length - 1] = C[C.length - 1].trimStart());
    let n = A(C[C.length - 1]);
    if (E !== 0 && (n >= u && (F.wordWrap === false || F.trim === false) && (C.push(""), n = 0), (n > 0 || F.trim === false) && (C[C.length - 1] += " ", n++)), F.hard && D[E] > u) {
      const B = u - n, p = 1 + Math.floor((D[E] - B - 1) / u);
      Math.floor((D[E] - 1) / u) < p && C.push(""), _(C, a, u);
      continue;
    }
    if (n + D[E] > u && n > 0 && D[E] > 0) {
      if (F.wordWrap === false && n < u) {
        _(C, a, u);
        continue;
      }
      C.push("");
    }
    if (n + D[E] > u && F.wordWrap === false) {
      _(C, a, u);
      continue;
    }
    C[C.length - 1] += a;
  }
  F.trim !== false && (C = C.map((E) => nD(E)));
  const o = [...C.join(`
`)];
  for (const [E, a] of o.entries()) {
    if (e += a, v.has(a)) {
      const { groups: B } = new RegExp(`(?:\\${W}(?<code>\\d+)m|\\${y}(?<uri>.*)${w})`).exec(o.slice(E).join("")) || { groups: {} };
      if (B.code !== undefined) {
        const p = Number.parseFloat(B.code);
        s = p === CD ? undefined : p;
      } else
        B.uri !== undefined && (i = B.uri.length === 0 ? undefined : B.uri);
    }
    const n = iD.codes.get(Number(s));
    o[E + 1] === `
` ? (i && (e += z("")), s && n && (e += V(n))) : a === `
` && (s && n && (e += V(s)), i && (e += z(i)));
  }
  return e;
};
function G(t, u, F) {
  return String(t).normalize().replace(/\r\n/g, `
`).split(`
`).map((e) => oD(e, u, F)).join(`
`);
}
var aD = ["up", "down", "left", "right", "space", "enter", "cancel"];
var c = { actions: new Set(aD), aliases: new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"], ["\x03", "cancel"], ["escape", "cancel"]]) };
function hD(t) {
  for (const u in t) {
    const F = u;
    if (!Object.hasOwn(t, F))
      continue;
    const e = t[F];
    switch (F) {
      case "aliases": {
        for (const s in e)
          Object.hasOwn(e, s) && (c.aliases.has(s) || c.aliases.set(s, e[s]));
        break;
      }
    }
  }
}
function k(t, u) {
  if (typeof t == "string")
    return c.aliases.get(t) === u;
  for (const F of t)
    if (F !== undefined && k(F, u))
      return true;
  return false;
}
function lD(t, u) {
  if (t === u)
    return;
  const F = t.split(`
`), e = u.split(`
`), s = [];
  for (let i = 0;i < Math.max(F.length, e.length); i++)
    F[i] !== e[i] && s.push(i);
  return s;
}
var xD = globalThis.process.platform.startsWith("win");
var S = Symbol("clack:cancel");
function BD(t) {
  return t === S;
}
function d(t, u) {
  const F = t;
  F.isTTY && F.setRawMode(u);
}
function cD({ input: t = $, output: u = j, overwrite: F = true, hideCursor: e = true } = {}) {
  const s = f.createInterface({ input: t, output: u, prompt: "", tabSize: 1 });
  f.emitKeypressEvents(t, s), t.isTTY && t.setRawMode(true);
  const i = (D, { name: C, sequence: o }) => {
    const E = String(D);
    if (k([E, C, o], "cancel")) {
      e && u.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!F)
      return;
    const a = C === "return" ? 0 : -1, n = C === "return" ? -1 : 0;
    f.moveCursor(u, a, n, () => {
      f.clearLine(u, 1, () => {
        t.once("keypress", i);
      });
    });
  };
  return e && u.write(import_sisteransi.cursor.hide), t.once("keypress", i), () => {
    t.off("keypress", i), e && u.write(import_sisteransi.cursor.show), t.isTTY && !xD && t.setRawMode(false), s.terminal = false, s.close();
  };
}
var AD = Object.defineProperty;
var pD = (t, u, F) => (u in t) ? AD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var h = (t, u, F) => (pD(t, typeof u != "symbol" ? u + "" : u, F), F);

class x {
  constructor(u, F = true) {
    h(this, "input"), h(this, "output"), h(this, "_abortSignal"), h(this, "rl"), h(this, "opts"), h(this, "_render"), h(this, "_track", false), h(this, "_prevFrame", ""), h(this, "_subscribers", new Map), h(this, "_cursor", 0), h(this, "state", "initial"), h(this, "error", ""), h(this, "value");
    const { input: e = $, output: s = j, render: i, signal: D, ...C } = u;
    this.opts = C, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = i.bind(this), this._track = F, this._abortSignal = D, this.input = e, this.output = s;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(u, F) {
    const e = this._subscribers.get(u) ?? [];
    e.push(F), this._subscribers.set(u, e);
  }
  on(u, F) {
    this.setSubscriber(u, { cb: F });
  }
  once(u, F) {
    this.setSubscriber(u, { cb: F, once: true });
  }
  emit(u, ...F) {
    const e = this._subscribers.get(u) ?? [], s = [];
    for (const i of e)
      i.cb(...F), i.once && s.push(() => e.splice(e.indexOf(i), 1));
    for (const i of s)
      i();
  }
  prompt() {
    return new Promise((u, F) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted)
          return this.state = "cancel", this.close(), u(S);
        this._abortSignal.addEventListener("abort", () => {
          this.state = "cancel", this.close();
        }, { once: true });
      }
      const e = new U(0);
      e._write = (s, i, D) => {
        this._track && (this.value = this.rl?.line.replace(/\t/g, ""), this._cursor = this.rl?.cursor ?? 0, this.emit("value", this.value)), D();
      }, this.input.pipe(e), this.rl = M.createInterface({ input: this.input, output: e, tabSize: 2, prompt: "", escapeCodeTimeout: 50 }), M.emitKeypressEvents(this.input, this.rl), this.rl.prompt(), this.opts.initialValue !== undefined && this._track && this.rl.write(this.opts.initialValue), this.input.on("keypress", this.onKeypress), d(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u(S);
      });
    });
  }
  onKeypress(u, F) {
    if (this.state === "error" && (this.state = "active"), F?.name && (!this._track && c.aliases.has(F.name) && this.emit("cursor", c.aliases.get(F.name)), c.actions.has(F.name) && this.emit("cursor", F.name)), u && (u.toLowerCase() === "y" || u.toLowerCase() === "n") && this.emit("confirm", u.toLowerCase() === "y"), u === "\t" && this.opts.placeholder && (this.value || (this.rl?.write(this.opts.placeholder), this.emit("value", this.opts.placeholder))), u && this.emit("key", u.toLowerCase()), F?.name === "return") {
      if (this.opts.validate) {
        const e = this.opts.validate(this.value);
        e && (this.error = e instanceof Error ? e.message : e, this.state = "error", this.rl?.write(this.value));
      }
      this.state !== "error" && (this.state = "submit");
    }
    k([u, F?.name, F?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), d(this.input, false), this.rl?.close(), this.rl = undefined, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const u = G(this._prevFrame, process.stdout.columns, { hard: true }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, u * -1));
  }
  render() {
    const u = G(this._render(this) ?? "", process.stdout.columns, { hard: true });
    if (u !== this._prevFrame) {
      if (this.state === "initial")
        this.output.write(import_sisteransi.cursor.hide);
      else {
        const F = lD(this._prevFrame, u);
        if (this.restoreCursor(), F && F?.length === 1) {
          const e = F[0];
          this.output.write(import_sisteransi.cursor.move(0, e)), this.output.write(import_sisteransi.erase.lines(1));
          const s = u.split(`
`);
          this.output.write(s[e]), this._prevFrame = u, this.output.write(import_sisteransi.cursor.move(0, s.length - e - 1));
          return;
        }
        if (F && F?.length > 1) {
          const e = F[0];
          this.output.write(import_sisteransi.cursor.move(0, e)), this.output.write(import_sisteransi.erase.down());
          const s = u.split(`
`).slice(e);
          this.output.write(s.join(`
`)), this._prevFrame = u;
          return;
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(u), this.state === "initial" && (this.state = "active"), this._prevFrame = u;
    }
  }
}

class fD extends x {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(u) {
    super(u, false), this.value = !!u.initialValue, this.on("value", () => {
      this.value = this._value;
    }), this.on("confirm", (F) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = F, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
}
var gD = Object.defineProperty;
var vD = (t, u, F) => (u in t) ? gD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var K = (t, u, F) => (vD(t, typeof u != "symbol" ? u + "" : u, F), F);
var dD = class extends x {
  constructor(u) {
    super(u, false), K(this, "options"), K(this, "cursor", 0);
    const { options: F } = u;
    this.options = Object.entries(F).flatMap(([e, s]) => [{ value: e, group: true, label: e }, ...s.map((i) => ({ ...i, group: e }))]), this.value = [...u.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: e }) => e === u.cursorAt), 0), this.on("cursor", (e) => {
      switch (e) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
  getGroupItems(u) {
    return this.options.filter((F) => F.group === u);
  }
  isGroupSelected(u) {
    return this.getGroupItems(u).every((F) => this.value.includes(F.value));
  }
  toggleValue() {
    const u = this.options[this.cursor];
    if (u.group === true) {
      const F = u.value, e = this.getGroupItems(F);
      this.isGroupSelected(F) ? this.value = this.value.filter((s) => e.findIndex((i) => i.value === s) === -1) : this.value = [...this.value, ...e.map((s) => s.value)], this.value = Array.from(new Set(this.value));
    } else {
      const F = this.value.includes(u.value);
      this.value = F ? this.value.filter((e) => e !== u.value) : [...this.value, u.value];
    }
  }
};
var bD = Object.defineProperty;
var mD = (t, u, F) => (u in t) ? bD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var Y = (t, u, F) => (mD(t, typeof u != "symbol" ? u + "" : u, F), F);
var wD = class extends x {
  constructor(u) {
    super(u, false), Y(this, "options"), Y(this, "cursor", 0), this.options = u.options, this.value = [...u.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: F }) => F === u.cursorAt), 0), this.on("key", (F) => {
      F === "a" && this.toggleAll();
    }), this.on("cursor", (F) => {
      switch (F) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
  get _value() {
    return this.options[this.cursor].value;
  }
  toggleAll() {
    const u = this.value.length === this.options.length;
    this.value = u ? [] : this.options.map((F) => F.value);
  }
  toggleValue() {
    const u = this.value.includes(this._value);
    this.value = u ? this.value.filter((F) => F !== this._value) : [...this.value, this._value];
  }
};
var yD = Object.defineProperty;
var _D = (t, u, F) => (u in t) ? yD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var Z = (t, u, F) => (_D(t, typeof u != "symbol" ? u + "" : u, F), F);

class kD extends x {
  constructor({ mask: u, ...F }) {
    super(F), Z(this, "valueWithCursor", ""), Z(this, "_mask", "•"), this._mask = u ?? "•", this.on("finalize", () => {
      this.valueWithCursor = this.masked;
    }), this.on("value", () => {
      if (this.cursor >= this.value.length)
        this.valueWithCursor = `${this.masked}${import_picocolors.default.inverse(import_picocolors.default.hidden("_"))}`;
      else {
        const e = this.masked.slice(0, this.cursor), s = this.masked.slice(this.cursor);
        this.valueWithCursor = `${e}${import_picocolors.default.inverse(s[0])}${s.slice(1)}`;
      }
    });
  }
  get cursor() {
    return this._cursor;
  }
  get masked() {
    return this.value.replaceAll(/./g, this._mask);
  }
}
var SD = Object.defineProperty;
var $D = (t, u, F) => (u in t) ? SD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var q = (t, u, F) => ($D(t, typeof u != "symbol" ? u + "" : u, F), F);

class jD extends x {
  constructor(u) {
    super(u, false), q(this, "options"), q(this, "cursor", 0), this.options = u.options, this.cursor = this.options.findIndex(({ value: F }) => F === u.initialValue), this.cursor === -1 && (this.cursor = 0), this.changeValue(), this.on("cursor", (F) => {
      switch (F) {
        case "left":
        case "up":
          this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
          break;
        case "down":
        case "right":
          this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
          break;
      }
      this.changeValue();
    });
  }
  get _value() {
    return this.options[this.cursor];
  }
  changeValue() {
    this.value = this._value.value;
  }
}
var MD = Object.defineProperty;
var TD = (t, u, F) => (u in t) ? MD(t, u, { enumerable: true, configurable: true, writable: true, value: F }) : t[u] = F;
var H = (t, u, F) => (TD(t, typeof u != "symbol" ? u + "" : u, F), F);

class OD extends x {
  constructor(u) {
    super(u, false), H(this, "options"), H(this, "cursor", 0), this.options = u.options;
    const F = this.options.map(({ value: [e] }) => e?.toLowerCase());
    this.cursor = Math.max(F.indexOf(u.initialValue), 0), this.on("key", (e) => {
      if (!F.includes(e))
        return;
      const s = this.options.find(({ value: [i] }) => i?.toLowerCase() === e);
      s && (this.value = s.value, this.state = "submit", this.emit("submit"));
    });
  }
}

class PD extends x {
  get valueWithCursor() {
    if (this.state === "submit")
      return this.value;
    if (this.cursor >= this.value.length)
      return `${this.value}█`;
    const u = this.value.slice(0, this.cursor), [F, ...e] = this.value.slice(this.cursor);
    return `${u}${import_picocolors.default.inverse(F)}${e.join("")}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(u) {
    super(u), this.on("finalize", () => {
      this.value || (this.value = u.defaultValue);
    });
  }
}

// node_modules/@clack/prompts/dist/index.mjs
var import_picocolors2 = __toESM(require_picocolors(), 1);
var import_sisteransi2 = __toESM(require_src(), 1);
import p from "node:process";
function X2() {
  return p.platform !== "win32" ? p.env.TERM !== "linux" : !!p.env.CI || !!p.env.WT_SESSION || !!p.env.TERMINUS_SUBLIME || p.env.ConEmuTask === "{cmd::Cmder}" || p.env.TERM_PROGRAM === "Terminus-Sublime" || p.env.TERM_PROGRAM === "vscode" || p.env.TERM === "xterm-256color" || p.env.TERM === "alacritty" || p.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var E = X2();
var u = (s, n) => E ? s : n;
var ee = u("◆", "*");
var A2 = u("■", "x");
var B = u("▲", "x");
var S2 = u("◇", "o");
var te = u("┌", "T");
var a = u("│", "|");
var m2 = u("└", "—");
var j2 = u("●", ">");
var R2 = u("○", " ");
var V2 = u("◻", "[•]");
var M2 = u("◼", "[+]");
var G2 = u("◻", "[ ]");
var se = u("▪", "•");
var N2 = u("─", "-");
var re = u("╮", "+");
var ie = u("├", "+");
var ne = u("╯", "+");
var ae = u("●", "•");
var oe = u("◆", "*");
var ce = u("▲", "!");
var le = u("■", "x");
var y2 = (s) => {
  switch (s) {
    case "initial":
    case "active":
      return import_picocolors2.default.cyan(ee);
    case "cancel":
      return import_picocolors2.default.red(A2);
    case "error":
      return import_picocolors2.default.yellow(B);
    case "submit":
      return import_picocolors2.default.green(S2);
  }
};
var k2 = (s) => {
  const { cursor: n, options: t, style: i } = s, r = s.maxItems ?? Number.POSITIVE_INFINITY, c = Math.max(process.stdout.rows - 4, 0), o = Math.min(c, Math.max(r, 5));
  let l = 0;
  n >= l + o - 3 ? l = Math.max(Math.min(n - o + 3, t.length - o), 0) : n < l + 2 && (l = Math.max(n - 2, 0));
  const $ = o < t.length && l > 0, d = o < t.length && l + o < t.length;
  return t.slice(l, l + o).map((w, b, C) => {
    const I = b === 0 && $, x = b === C.length - 1 && d;
    return I || x ? import_picocolors2.default.dim("...") : i(w, b + l === n);
  });
};
var ue = (s) => new PD({ validate: s.validate, placeholder: s.placeholder, defaultValue: s.defaultValue, initialValue: s.initialValue, render() {
  const n = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, t = s.placeholder ? import_picocolors2.default.inverse(s.placeholder[0]) + import_picocolors2.default.dim(s.placeholder.slice(1)) : import_picocolors2.default.inverse(import_picocolors2.default.hidden("_")), i = this.value ? this.valueWithCursor : t;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors2.default.yellow(a)}  ${i}
${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(this.value || s.placeholder)}`;
    case "cancel":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(this.value ?? ""))}${this.value?.trim() ? `
${import_picocolors2.default.gray(a)}` : ""}`;
    default:
      return `${n}${import_picocolors2.default.cyan(a)}  ${i}
${import_picocolors2.default.cyan(m2)}
`;
  }
} }).prompt();
var $e = (s) => new kD({ validate: s.validate, mask: s.mask ?? se, render() {
  const n = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, t = this.valueWithCursor, i = this.masked;
  switch (this.state) {
    case "error":
      return `${n.trim()}
${import_picocolors2.default.yellow(a)}  ${i}
${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(this.error)}
`;
    case "submit":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(i)}`;
    case "cancel":
      return `${n}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(i ?? ""))}${i ? `
${import_picocolors2.default.gray(a)}` : ""}`;
    default:
      return `${n}${import_picocolors2.default.cyan(a)}  ${t}
${import_picocolors2.default.cyan(m2)}
`;
  }
} }).prompt();
var me = (s) => {
  const n = s.active ?? "Yes", t = s.inactive ?? "No";
  return new fD({ active: n, inactive: t, initialValue: s.initialValue ?? true, render() {
    const i = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, r = this.value ? n : t;
    switch (this.state) {
      case "submit":
        return `${i}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(r)}`;
      case "cancel":
        return `${i}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r))}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${i}${import_picocolors2.default.cyan(a)}  ${this.value ? `${import_picocolors2.default.green(j2)} ${n}` : `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(n)}`} ${import_picocolors2.default.dim("/")} ${this.value ? `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(t)}` : `${import_picocolors2.default.green(j2)} ${t}`}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var de = (s) => {
  const n = (t, i) => {
    const r = t.label ?? String(t.value);
    switch (i) {
      case "selected":
        return `${import_picocolors2.default.dim(r)}`;
      case "active":
        return `${import_picocolors2.default.green(j2)} ${r} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}`;
      case "cancelled":
        return `${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r))}`;
      default:
        return `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(r)}`;
    }
  };
  return new jD({ options: s.options, initialValue: s.initialValue, render() {
    const t = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`;
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options[this.cursor], "selected")}`;
      case "cancel":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options[this.cursor], "cancelled")}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${t}${import_picocolors2.default.cyan(a)}  ${k2({ cursor: this.cursor, options: this.options, maxItems: s.maxItems, style: (i, r) => n(i, r ? "active" : "inactive") }).join(`
${import_picocolors2.default.cyan(a)}  `)}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var he = (s) => {
  const n = (t, i = "inactive") => {
    const r = t.label ?? String(t.value);
    return i === "selected" ? `${import_picocolors2.default.dim(r)}` : i === "cancelled" ? `${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r))}` : i === "active" ? `${import_picocolors2.default.bgCyan(import_picocolors2.default.gray(` ${t.value} `))} ${r} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}` : `${import_picocolors2.default.gray(import_picocolors2.default.bgWhite(import_picocolors2.default.inverse(` ${t.value} `)))} ${r} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}`;
  };
  return new OD({ options: s.options, initialValue: s.initialValue, render() {
    const t = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`;
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options.find((i) => i.value === this.value) ?? s.options[0], "selected")}`;
      case "cancel":
        return `${t}${import_picocolors2.default.gray(a)}  ${n(this.options[0], "cancelled")}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${t}${import_picocolors2.default.cyan(a)}  ${this.options.map((i, r) => n(i, r === this.cursor ? "active" : "inactive")).join(`
${import_picocolors2.default.cyan(a)}  `)}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var pe = (s) => {
  const n = (t, i) => {
    const r = t.label ?? String(t.value);
    return i === "active" ? `${import_picocolors2.default.cyan(V2)} ${r} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}` : i === "selected" ? `${import_picocolors2.default.green(M2)} ${import_picocolors2.default.dim(r)}` : i === "cancelled" ? `${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r))}` : i === "active-selected" ? `${import_picocolors2.default.green(M2)} ${r} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}` : i === "submitted" ? `${import_picocolors2.default.dim(r)}` : `${import_picocolors2.default.dim(G2)} ${import_picocolors2.default.dim(r)}`;
  };
  return new wD({ options: s.options, initialValues: s.initialValues, required: s.required ?? true, cursorAt: s.cursorAt, validate(t) {
    if (this.required && t.length === 0)
      return `Please select at least one option.
${import_picocolors2.default.reset(import_picocolors2.default.dim(`Press ${import_picocolors2.default.gray(import_picocolors2.default.bgWhite(import_picocolors2.default.inverse(" space ")))} to select, ${import_picocolors2.default.gray(import_picocolors2.default.bgWhite(import_picocolors2.default.inverse(" enter ")))} to submit`))}`;
  }, render() {
    const t = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`, i = (r, c) => {
      const o = this.value.includes(r.value);
      return c && o ? n(r, "active-selected") : o ? n(r, "selected") : n(r, c ? "active" : "inactive");
    };
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors2.default.gray(a)}  ${this.options.filter(({ value: r }) => this.value.includes(r)).map((r) => n(r, "submitted")).join(import_picocolors2.default.dim(", ")) || import_picocolors2.default.dim("none")}`;
      case "cancel": {
        const r = this.options.filter(({ value: c }) => this.value.includes(c)).map((c) => n(c, "cancelled")).join(import_picocolors2.default.dim(", "));
        return `${t}${import_picocolors2.default.gray(a)}  ${r.trim() ? `${r}
${import_picocolors2.default.gray(a)}` : ""}`;
      }
      case "error": {
        const r = this.error.split(`
`).map((c, o) => o === 0 ? `${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(c)}` : `   ${c}`).join(`
`);
        return `${t + import_picocolors2.default.yellow(a)}  ${k2({ options: this.options, cursor: this.cursor, maxItems: s.maxItems, style: i }).join(`
${import_picocolors2.default.yellow(a)}  `)}
${r}
`;
      }
      default:
        return `${t}${import_picocolors2.default.cyan(a)}  ${k2({ options: this.options, cursor: this.cursor, maxItems: s.maxItems, style: i }).join(`
${import_picocolors2.default.cyan(a)}  `)}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var ge = (s) => {
  const n = (t, i, r = []) => {
    const c = t.label ?? String(t.value), o = typeof t.group == "string", l = o && (r[r.indexOf(t) + 1] ?? { group: true }), $ = o && l.group === true, d = o ? `${$ ? m2 : a} ` : "";
    return i === "active" ? `${import_picocolors2.default.dim(d)}${import_picocolors2.default.cyan(V2)} ${c} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}` : i === "group-active" ? `${d}${import_picocolors2.default.cyan(V2)} ${import_picocolors2.default.dim(c)}` : i === "group-active-selected" ? `${d}${import_picocolors2.default.green(M2)} ${import_picocolors2.default.dim(c)}` : i === "selected" ? `${import_picocolors2.default.dim(d)}${import_picocolors2.default.green(M2)} ${import_picocolors2.default.dim(c)}` : i === "cancelled" ? `${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(c))}` : i === "active-selected" ? `${import_picocolors2.default.dim(d)}${import_picocolors2.default.green(M2)} ${c} ${t.hint ? import_picocolors2.default.dim(`(${t.hint})`) : ""}` : i === "submitted" ? `${import_picocolors2.default.dim(c)}` : `${import_picocolors2.default.dim(d)}${import_picocolors2.default.dim(G2)} ${import_picocolors2.default.dim(c)}`;
  };
  return new dD({ options: s.options, initialValues: s.initialValues, required: s.required ?? true, cursorAt: s.cursorAt, validate(t) {
    if (this.required && t.length === 0)
      return `Please select at least one option.
${import_picocolors2.default.reset(import_picocolors2.default.dim(`Press ${import_picocolors2.default.gray(import_picocolors2.default.bgWhite(import_picocolors2.default.inverse(" space ")))} to select, ${import_picocolors2.default.gray(import_picocolors2.default.bgWhite(import_picocolors2.default.inverse(" enter ")))} to submit`))}`;
  }, render() {
    const t = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s.message}
`;
    switch (this.state) {
      case "submit":
        return `${t}${import_picocolors2.default.gray(a)}  ${this.options.filter(({ value: i }) => this.value.includes(i)).map((i) => n(i, "submitted")).join(import_picocolors2.default.dim(", "))}`;
      case "cancel": {
        const i = this.options.filter(({ value: r }) => this.value.includes(r)).map((r) => n(r, "cancelled")).join(import_picocolors2.default.dim(", "));
        return `${t}${import_picocolors2.default.gray(a)}  ${i.trim() ? `${i}
${import_picocolors2.default.gray(a)}` : ""}`;
      }
      case "error": {
        const i = this.error.split(`
`).map((r, c) => c === 0 ? `${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(r)}` : `   ${r}`).join(`
`);
        return `${t}${import_picocolors2.default.yellow(a)}  ${this.options.map((r, c, o) => {
          const l = this.value.includes(r.value) || r.group === true && this.isGroupSelected(`${r.value}`), $ = c === this.cursor;
          return !$ && typeof r.group == "string" && this.options[this.cursor].value === r.group ? n(r, l ? "group-active-selected" : "group-active", o) : $ && l ? n(r, "active-selected", o) : l ? n(r, "selected", o) : n(r, $ ? "active" : "inactive", o);
        }).join(`
${import_picocolors2.default.yellow(a)}  `)}
${i}
`;
      }
      default:
        return `${t}${import_picocolors2.default.cyan(a)}  ${this.options.map((i, r, c) => {
          const o = this.value.includes(i.value) || i.group === true && this.isGroupSelected(`${i.value}`), l = r === this.cursor;
          return !l && typeof i.group == "string" && this.options[this.cursor].value === i.group ? n(i, o ? "group-active-selected" : "group-active", c) : l && o ? n(i, "active-selected", c) : o ? n(i, "selected", c) : n(i, l ? "active" : "inactive", c);
        }).join(`
${import_picocolors2.default.cyan(a)}  `)}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var ye = (s = "", n = "") => {
  const t = `
${s}
`.split(`
`), i = T2(n).length, r = Math.max(t.reduce((o, l) => {
    const $ = T2(l);
    return $.length > o ? $.length : o;
  }, 0), i) + 2, c = t.map((o) => `${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(o)}${" ".repeat(r - T2(o).length)}${import_picocolors2.default.gray(a)}`).join(`
`);
  process.stdout.write(`${import_picocolors2.default.gray(a)}
${import_picocolors2.default.green(S2)}  ${import_picocolors2.default.reset(n)} ${import_picocolors2.default.gray(N2.repeat(Math.max(r - i - 1, 1)) + re)}
${c}
${import_picocolors2.default.gray(ie + N2.repeat(r + 2) + ne)}
`);
};
var ve = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(m2)}  ${import_picocolors2.default.red(s)}

`);
};
var we = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(te)}  ${s}
`);
};
var fe = (s = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(a)}
${import_picocolors2.default.gray(m2)}  ${s}

`);
};
var v2 = { message: (s = "", { symbol: n = import_picocolors2.default.gray(a) } = {}) => {
  const t = [`${import_picocolors2.default.gray(a)}`];
  if (s) {
    const [i, ...r] = s.split(`
`);
    t.push(`${n}  ${i}`, ...r.map((c) => `${import_picocolors2.default.gray(a)}  ${c}`));
  }
  process.stdout.write(`${t.join(`
`)}
`);
}, info: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.blue(ae) });
}, success: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.green(oe) });
}, step: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.green(S2) });
}, warn: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.yellow(ce) });
}, warning: (s) => {
  v2.warn(s);
}, error: (s) => {
  v2.message(s, { symbol: import_picocolors2.default.red(le) });
} };
var L2 = () => {
  const s = E ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"], n = E ? 80 : 120, t = process.env.CI === "true";
  let i, r, c = false, o = "", l;
  const $ = (h) => {
    const g = h > 1 ? "Something went wrong" : "Canceled";
    c && P(g, h);
  }, d = () => $(2), w = () => $(1), b = () => {
    process.on("uncaughtExceptionMonitor", d), process.on("unhandledRejection", d), process.on("SIGINT", w), process.on("SIGTERM", w), process.on("exit", $);
  }, C = () => {
    process.removeListener("uncaughtExceptionMonitor", d), process.removeListener("unhandledRejection", d), process.removeListener("SIGINT", w), process.removeListener("SIGTERM", w), process.removeListener("exit", $);
  }, I = () => {
    if (l === undefined)
      return;
    t && process.stdout.write(`
`);
    const h = l.split(`
`);
    process.stdout.write(import_sisteransi2.cursor.move(-999, h.length - 1)), process.stdout.write(import_sisteransi2.erase.down(h.length));
  }, x = (h) => h.replace(/\.+$/, ""), O = (h = "") => {
    c = true, i = cD(), o = x(h), process.stdout.write(`${import_picocolors2.default.gray(a)}
`);
    let g = 0, f = 0;
    b(), r = setInterval(() => {
      if (t && o === l)
        return;
      I(), l = o;
      const W = import_picocolors2.default.magenta(s[g]), _ = t ? "..." : ".".repeat(Math.floor(f)).slice(0, 3);
      process.stdout.write(`${W}  ${o}${_}`), g = g + 1 < s.length ? g + 1 : 0, f = f < s.length ? f + 0.125 : 0;
    }, n);
  }, P = (h = "", g = 0) => {
    c = false, clearInterval(r), I();
    const f = g === 0 ? import_picocolors2.default.green(S2) : g === 1 ? import_picocolors2.default.red(A2) : import_picocolors2.default.red(B);
    o = x(h ?? o), process.stdout.write(`${f}  ${o}
`), C(), i();
  };
  return { start: O, stop: P, message: (h = "") => {
    o = x(h ?? o);
  } };
};
var be = async (s, n) => {
  const t = {}, i = Object.keys(s);
  for (const r of i) {
    const c = s[r], o = await c({ results: t })?.catch((l) => {
      throw l;
    });
    if (typeof n?.onCancel == "function" && BD(o)) {
      t[r] = "canceled", n.onCancel({ results: t });
      continue;
    }
    t[r] = o;
  }
  return t;
};
var xe = async (s) => {
  for (const n of s) {
    if (n.enabled === false)
      continue;
    const t = L2();
    t.start(n.title);
    const i = await n.task(t.message);
    t.stop(i || n.title);
  }
};

// src/prompts/index.ts
init_fs();
import { dirname as dirname7 } from "path";

// src/prompts/helpers.ts
init_github();
init_fs();
init_lockfile();

// src/installer.ts
init_github();
init_lockfile();
init_security();
init_fs();
init_config();
import {
  existsSync as existsSync5,
  mkdirSync as mkdirSync3,
  writeFileSync as writeFileSync5,
  unlinkSync as unlinkSync2,
  readdirSync as readdirSync2,
  statSync as statSync2,
  copyFileSync as copyFileSync2,
  readFileSync as readFileSync5,
  rmSync as rmSync3
} from "fs";
import { execFileSync as execFileSync2, spawn } from "child_process";
import { dirname as dirname4, join as join6 } from "path";
import { pathToFileURL } from "url";
function createMcpConfigEntry(name, nodeExecutable, serverPath, statePath) {
  const entry = {
    type: "local",
    command: [nodeExecutable, serverPath],
    enabled: true
  };
  if (name === "ostacky-controller" && statePath) {
    entry.environment = { OSTACKY_STATE_PATH: statePath };
  }
  return entry;
}
function getVerifiedNodeExecutable() {
  const nodeExecutable = findExecutablePath("node");
  if (!nodeExecutable) {
    throw new Error("No se encontró Node.js en PATH; no se puede iniciar un MCP local.");
  }
  try {
    execFileSync2(nodeExecutable, ["--version"], { stdio: "pipe", timeout: 1e4 });
  } catch (error) {
    throw new Error(`Node.js no se puede ejecutar desde ${nodeExecutable}: ${error.message}`);
  }
  return nodeExecutable;
}
function validateMcpModule(nodeExecutable, serverPath, cwd) {
  try {
    execFileSync2(nodeExecutable, ["--input-type=module", "--eval", "await import(process.env.OSTACKY_MCP_PROBE)"], {
      cwd,
      env: { ...process.env, OSTACKY_MCP_PROBE: pathToFileURL(serverPath).href },
      stdio: "pipe",
      timeout: 15000
    });
  } catch (error) {
    throw new Error(`El MCP no pasó la validación de carga: ${error.message}`);
  }
}
var DEFAULT_PROBE_OPTIONS = {
  requiredTools: ["ping", "start_request"],
  exerciseWrite: true
};
async function probeMcpServer(nodeExecutable, serverPath, cwd, statePath, options = {}) {
  const requiredTools = options.requiredTools ?? DEFAULT_PROBE_OPTIONS.requiredTools;
  const exerciseWrite = options.exerciseWrite ?? requiredTools.includes("start_request");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(nodeExecutable, [serverPath], {
        cwd,
        env: {
          ...process.env,
          ...statePath ? { OSTACKY_STATE_PATH: statePath } : {}
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      let settled = false;
      let stderr = "";
      let stdoutBuffer = "";
      const requestTimeout = 1e4;
      let exitTimeout;
      const finish = (error) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        try {
          child.stdin?.end();
        } catch {}
        if (child.exitCode === null) {
          const onExit = () => {
            if (exitTimeout)
              clearTimeout(exitTimeout);
            error ? reject(error) : resolve();
          };
          child.once("exit", onExit);
          child.kill();
          exitTimeout = setTimeout(onExit, 500);
        } else {
          error ? reject(error) : resolve();
        }
      };
      const fail = (message) => finish(new Error(`${message}${stderr ? `: ${stderr.trim()}` : ""}`));
      const send = (message) => {
        try {
          child.stdin?.write(JSON.stringify(message) + `
`);
        } catch (error) {
          finish(error);
        }
      };
      const timer = setTimeout(() => fail("El MCP no completó el health check a tiempo"), requestTimeout);
      child.once("error", (error) => finish(error));
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("exit", (code, signal) => {
        fail(`El MCP terminó durante el health check (código ${code ?? "null"}, señal ${signal ?? "ninguna"})`);
      });
      child.stdout?.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim())
            continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.error) {
            fail(`El MCP respondió un error: ${message.error.message ?? "desconocido"}`);
            return;
          }
          if (message.id === 1) {
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
            continue;
          }
          if (message.id === 2) {
            const tools = message.result?.tools ?? [];
            const missing = requiredTools.filter((name) => !tools.some((tool) => tool.name === name));
            if (missing.length > 0) {
              fail(`El MCP inició pero no expuso las tools requeridas: ${missing.join(", ")}`);
              return;
            }
            if (exerciseWrite) {
              send({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: "start_request", arguments: { requestId: "installer-probe" } }
              });
              continue;
            }
            finish();
            return;
          }
          if (message.id === 3) {
            const result = message.result;
            if (result?.isError) {
              fail("La tool start_request falló durante el health check");
              return;
            }
            finish();
          }
        }
      });
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ostacky-installer", version: "0.8.8" }
        }
      });
    });
  } finally {
    await new Promise((r) => setTimeout(r, 200));
    if (statePath) {
      for (const p of [
        statePath,
        statePath + ".backup",
        statePath + ".lock.pid",
        statePath + ".lock.timestamp",
        statePath + ".tmp." + process.pid
      ]) {
        try {
          if (existsSync5(p))
            rmSync3(p, { force: true });
        } catch {}
      }
      try {
        const { dirname, join } = await import("path");
        const handoff = join(dirname(statePath), ".ostacky-handoff-compaction.json");
        if (existsSync5(handoff)) {
          try {
            rmSync3(handoff, { force: true });
          } catch {}
        }
      } catch {}
    }
  }
}
function takeFileSnapshot(path) {
  return { path, content: existsSync5(path) ? readFileSync5(path, "utf-8") : null };
}
function restoreFileSnapshot(snapshot) {
  if (snapshot.content === null) {
    if (existsSync5(snapshot.path))
      rmSync3(snapshot.path, { force: true });
    return;
  }
  writeFileSync5(snapshot.path, snapshot.content, "utf-8");
}
function upsertLockfile(paths, type, item, manifest, contentHash) {
  const existing = readLockfile(paths.root) ?? {
    version: manifest.version,
    lockedAt: new Date().toISOString(),
    repo: manifest.repo,
    tag: manifest.tag,
    agents: {},
    commands: {},
    skills: {}
  };
  if (!existing.skills)
    existing.skills = {};
  if (!existing.mcpServers)
    existing.mcpServers = {};
  if (!existing[type])
    existing[type] = {};
  existing[type][item.name] = {
    version: item.version,
    installedAt: new Date().toISOString(),
    sha256: contentHash
  };
  existing.tag = manifest.tag;
  existing.version = manifest.version;
  existing.lockedAt = new Date().toISOString();
  writeLockfile(paths.root, existing);
}
function readBundledAsset(relativePath) {
  const fullPath = join6(PACKAGE_ROOT, relativePath);
  if (!existsSync5(fullPath))
    return null;
  return readFileSync5(fullPath, "utf-8");
}
async function installAgent(item, manifest, paths) {
  let content;
  try {
    content = await downloadFile(manifest, item.file);
  } catch (downloadErr) {
    const bundled = readBundledAsset(item.file);
    if (bundled === null) {
      throw new Error(`Descarga falló (${downloadErr.message}) y el asset no está bundleado en ${item.file}`);
    }
    content = bundled;
  }
  writeFileSync5(join6(paths.agents, `${item.name}.md`), content, "utf-8");
  upsertLockfile(paths, "agents", item, manifest, sha256(content));
}
async function installCommand(item, manifest, paths) {
  let content;
  try {
    content = await downloadFile(manifest, item.file);
  } catch (downloadErr) {
    const bundled = readBundledAsset(item.file);
    if (bundled === null) {
      throw new Error(`Descarga falló (${downloadErr.message}) y el asset no está bundleado en ${item.file}`);
    }
    content = bundled;
  }
  writeFileSync5(join6(paths.commands, `${item.name}.md`), content, "utf-8");
  upsertLockfile(paths, "commands", item, manifest, sha256(content));
}
async function installSkill(item, manifest, paths) {
  const src = getBundledSkillPath(item.name);
  if (!existsSync5(src)) {
    throw new Error(`Skill bundleada no encontrada: ${src}. ¿Falta el directorio assets/skills/${item.name}/?`);
  }
  const treeHash = computeTreeHash(src);
  if (item.sha256 && treeHash !== item.sha256) {
    throw new Error(`Tree hash inválido para skill "${item.name}"
  esperado: ${item.sha256}
  recibido: ${treeHash}`);
  }
  const dest = join6(paths.skills, item.name);
  if (existsSync5(dest)) {
    rmSync3(dest, { recursive: true, force: true });
  }
  copyDirRecursive(src, dest);
  upsertLockfile(paths, "skills", item, manifest, treeHash);
}
function pruneStaleSkills(paths, manifest) {
  const expected = new Set(manifest.skills.map((s) => s.name));
  const removed = [];
  if (!existsSync5(paths.skills))
    return removed;
  for (const entry of readdirSync2(paths.skills)) {
    const dir = join6(paths.skills, entry);
    try {
      if (!statSync2(dir).isDirectory())
        continue;
    } catch {
      continue;
    }
    if (!expected.has(entry)) {
      try {
        rmSync3(dir, { recursive: true, force: true });
        removeFromLockfile(paths.root, "skills", entry);
        removed.push(entry);
      } catch {}
    }
  }
  return removed;
}
async function installMcpServer(item, manifest, paths) {
  const src = getBundledMcpPath(item.name);
  if (!existsSync5(src)) {
    throw new Error(`MCP server bundleado no encontrado: ${src}. ` + `¿Falta el directorio assets/mcp/${item.name}/?`);
  }
  const treeHash = computeTreeHash(src);
  if (item.sha256 && treeHash !== item.sha256) {
    throw new Error(`Tree hash inválido para MCP server "${item.name}"
  esperado: ${item.sha256}
  recibido: ${treeHash}`);
  }
  const nodeExecutable = getVerifiedNodeExecutable();
  const projectRoot = dirname4(paths.root);
  const dest = join6(paths.mcp, item.name);
  const staging = `${dest}.staging-${process.pid}-${Date.now()}`;
  const statePath = item.name === "ostacky-controller" ? join6(paths.root, "ostacky-state.json") : undefined;
  try {
    mkdirSync3(staging, { recursive: true });
    const bundledPath = join6(PACKAGE_ROOT, "dist", "mcp", item.name, "index.js");
    if (existsSync5(bundledPath)) {
      copyFileSync2(bundledPath, join6(staging, "index.js"));
      writeFileSync5(join6(staging, "package.json"), JSON.stringify({ type: "module" }) + `
`, "utf-8");
    } else {
      copyDirRecursive(src, staging, true);
      const useBun = isCommandAvailable("bun");
      const packageManager = useBun ? "bun" : "npm";
      if (!useBun && !isCommandAvailable("npm")) {
        throw new Error(`No se encontró Bun ni npm para instalar dependencias de ${item.name}.`);
      }
      const args = useBun ? ["install", "--no-save"] : ["install", "--no-audit", "--no-fund"];
      try {
        const invocation = getCommandInvocation(packageManager, args);
        execFileSync2(invocation.command, invocation.args, {
          cwd: staging,
          stdio: "pipe",
          timeout: 60000
        });
      } catch (error) {
        throw new Error(`No se pudieron instalar dependencias de ${item.name} con ${packageManager}: ${error.message}`);
      }
    }
    const stagedServerPath = join6(staging, "index.js");
    if (!existsSync5(stagedServerPath)) {
      throw new Error(`El MCP ${item.name} no contiene index.js después de instalarse.`);
    }
    validateMcpModule(nodeExecutable, stagedServerPath, staging);
    const isController = item.name === "ostacky-controller";
    const probeOptions = isController ? { requiredTools: ["ping", "start_request"], exerciseWrite: true } : { requiredTools: [], exerciseWrite: false };
    await probeMcpServer(nodeExecutable, stagedServerPath, staging, isController ? join6(staging, ".probe-state.json") : undefined, probeOptions);
    const configPath = findOpenCodeConfig(projectRoot) ?? join6(projectRoot, "opencode.json");
    const configSnapshot = takeFileSnapshot(configPath);
    const lockfileSnapshot = takeFileSnapshot(getLockfilePath(paths.root));
    const promotion = promoteStagedDirectory(staging, dest);
    try {
      setMcpEntryAtProjectRoot(projectRoot, item.name, createMcpConfigEntry(item.name, nodeExecutable, join6(dest, "index.js"), statePath));
      upsertLockfile(paths, "mcpServers", item, manifest, treeHash);
      promotion.commit();
    } catch (error) {
      try {
        restoreFileSnapshot(configSnapshot);
      } catch {}
      try {
        restoreFileSnapshot(lockfileSnapshot);
      } catch {}
      try {
        promotion.rollback();
      } catch {}
      throw error;
    }
  } finally {
    if (existsSync5(staging))
      rmSync3(staging, { recursive: true, force: true });
  }
}
function isMcpServerInstalled(name, paths) {
  return existsSync5(join6(paths.mcp, name, "index.js"));
}
function isAgentInstalled(name, paths) {
  return existsSync5(join6(paths.agents, `${name}.md`));
}
function isCommandInstalled(name, paths) {
  return existsSync5(join6(paths.commands, `${name}.md`));
}
function isSkillInstalled(name, paths) {
  return existsSync5(join6(paths.skills, name, "SKILL.md"));
}
function uninstallAgent(name, paths) {
  const filePath = join6(paths.agents, `${name}.md`);
  try {
    if (existsSync5(filePath)) {
      unlinkSync2(filePath);
    }
  } catch {
    return false;
  }
  removeFromLockfile(paths.root, "agents", name);
  return true;
}
function uninstallCommand(name, paths) {
  const filePath = join6(paths.commands, `${name}.md`);
  try {
    if (existsSync5(filePath)) {
      unlinkSync2(filePath);
    }
  } catch {
    return false;
  }
  removeFromLockfile(paths.root, "commands", name);
  return true;
}
function uninstallSkill(name, paths) {
  const dirPath = join6(paths.skills, name);
  try {
    if (existsSync5(dirPath)) {
      rmSync3(dirPath, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
  removeFromLockfile(paths.root, "skills", name);
  return true;
}
function uninstallMcpServer(name, paths) {
  const dirPath = join6(paths.mcp, name);
  try {
    if (existsSync5(dirPath)) {
      rmSync3(dirPath, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
  const projectRoot = dirname4(paths.root);
  const configPath = findOpenCodeConfig(projectRoot);
  if (configPath) {
    const config = readOpenCodeConfig(configPath);
    if (config) {
      const mcp = config.mcp;
      if (mcp && mcp[name]) {
        delete mcp[name];
        if (Object.keys(mcp).length === 0) {
          delete config.mcp;
        }
        writeOpenCodeConfig(configPath, config);
      }
    }
  }
  removeFromLockfile(paths.root, "mcpServers", name);
  return true;
}
function uninstallAll(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile)
    return;
  for (const name of Object.keys(lockfile.agents)) {
    uninstallAgent(name, paths);
  }
  for (const name of Object.keys(lockfile.commands)) {
    uninstallCommand(name, paths);
  }
  for (const name of Object.keys(lockfile.skills ?? {})) {
    uninstallSkill(name, paths);
  }
  for (const name of Object.keys(lockfile.mcpServers ?? {})) {
    uninstallMcpServer(name, paths);
  }
  const ostackyPlugins = [
    "ostacky-plugin.ts",
    "engram.ts",
    "ostacky-guard.ts",
    "ostacky-controller.ts",
    "controller-core.ts",
    "security.ts",
    "tiered.ts"
  ];
  for (const file of ostackyPlugins) {
    const fp = join6(paths.plugins, file);
    if (existsSync5(fp)) {
      try {
        unlinkSync2(fp);
      } catch {}
    }
  }
  clearLockfile(paths.root);
}

// src/prompts/helpers.ts
function onCancel(value) {
  if (BD(value)) {
    fe("Operación cancelada.");
    process.exit(0);
  }
}
async function loadManifest() {
  const spin = L2();
  spin.start("Obteniendo recursos disponibles...");
  const manifest = await fetchManifest();
  spin.stop(`Recursos cargados  (${manifest.tag})`);
  return manifest;
}
async function loadLatestManifest() {
  const spin = L2();
  spin.start("Buscando actualizaciones en GitHub...");
  const { manifest, isNew, latestTag } = await fetchLatestManifest();
  if (isNew && latestTag) {
    spin.stop(`Nueva versión detectada: ${latestTag}`);
  } else {
    spin.stop(`Manifest actualizado  (${manifest.tag})`);
  }
  return manifest;
}
function printPostInstallSteps() {
  ye([
    "Cerrá y reiniciá OpenCode si ya estaba corriendo (los MCP no recargan su config en caliente):",
    "  TUI → opencode",
    "  Web → opencode web --port 4096",
    "Escribí @Ostacky en el chat (TUI o web) para invocar al agente",
    "Skills bundleadas en .opencode/skills/ — revisá cuáles activás",
    "¿Errores en el stack? Ejecutá /install-stack desde el chat de OpenCode"
  ].join(`
`), "Próximos pasos");
}
async function resolveOpenCodePaths(scope) {
  const cwd = process.cwd();
  const dir = scope === "local" || !scope ? getOpenCodeDirForScope("local", cwd) : getOpenCodeDirForScope("local", cwd);
  if (scope && scope !== "local") {
    v2.warn(`Scope ${scope} removido; usando local en ${dir}`);
  }
  try {
    const paths = ensureOpenCodePaths(dir);
    ye(dir, "Instalación local");
    return paths;
  } catch (e) {
    throw e;
  }
}
function getOrphanedItems(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile)
    return [];
  const manifestNames = {
    agents: new Set(manifest.agents.map((a) => a.name)),
    commands: new Set(manifest.commands.map((c) => c.name)),
    skills: new Set((manifest.skills ?? []).map((s) => s.name)),
    mcpServers: new Set((manifest.mcpServers ?? []).map((m) => m.name))
  };
  const orphans = [];
  for (const type of ["agents", "commands", "skills", "mcpServers"]) {
    for (const [name, data] of Object.entries(lockfile[type] ?? {})) {
      if (!manifestNames[type].has(name)) {
        orphans.push({ type, name, version: data.version });
      }
    }
  }
  return orphans;
}
function getUpdateCandidates(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  const candidates = [];
  for (const item of manifest.agents) {
    if (!isAgentInstalled(item.name, paths))
      continue;
    const installed = getInstalledVersion(lockfile, "agents", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "agents", item, installedVersion: installed });
    }
  }
  for (const item of manifest.commands) {
    if (!isCommandInstalled(item.name, paths))
      continue;
    const installed = getInstalledVersion(lockfile, "commands", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "commands", item, installedVersion: installed });
    }
  }
  for (const item of manifest.skills ?? []) {
    if (!isSkillInstalled(item.name, paths))
      continue;
    const installed = getInstalledVersion(lockfile, "skills", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "skills", item, installedVersion: installed });
    }
  }
  for (const item of manifest.mcpServers ?? []) {
    if (!isMcpServerInstalled(item.name, paths))
      continue;
    const installed = getInstalledVersion(lockfile, "mcpServers", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "mcpServers", item, installedVersion: installed });
    }
  }
  return candidates;
}
function formatVersionDiff(from, to) {
  return from ? `${from} → ${to}` : `(sin versión) → ${to}`;
}
function kindLabel(type) {
  switch (type) {
    case "agents":
      return "agente";
    case "commands":
      return "command";
    case "skills":
      return "skill";
    case "mcpServers":
      return "MCP";
  }
}

// src/prompts/install.ts
import { dirname as dirname6, join as join8 } from "path";
import { existsSync as existsSync7 } from "fs";
init_stack();
init_fs();
async function doInstallStack(toolsDir, projectRoot) {
  const spin = L2();
  let allOk = true;
  const resolvedProjectRoot = projectRoot ?? dirname6(dirname6(toolsDir ?? join8(process.cwd(), ".opencode", "tools")));
  const resolvedToolsDir = toolsDir ?? join8(resolvedProjectRoot, ".opencode", "tools");
  v2.info(`Stack → projectRoot: ${resolvedProjectRoot} | toolsDir: ${resolvedToolsDir}`);
  try {
    const { homedir } = await import("os");
    const home = homedir();
    const inHome = resolvedProjectRoot.replace(/\\/g, "/") === home.replace(/\\/g, "/");
    if (inHome && !existsSync7(join8(home, ".git"))) {
      v2.warn(`Estás instalando el stack en tu home (${home}). Si esperabas instalar en un proyecto, hacé cd al proyecto y usá --scope local.`);
    }
  } catch {}
  spin.start("Instalando CodeGraph...");
  const cg = await installCodeGraph(toolsDir);
  spin.stop(cg.success ? `✓ ${cg.message}` : `✗ ${cg.message}`);
  if (!cg.success)
    allOk = false;
  spin.start("Configurando OpenSpec...");
  const os = setupOpenSpec(resolvedProjectRoot);
  spin.stop(os.success ? `✓ ${os.message}` : `✗ ${os.message}`);
  if (!os.success)
    allOk = false;
  spin.start("Instalando Engram...");
  const eng = await installEngram(toolsDir);
  spin.stop(eng.success ? `✓ ${eng.message}` : `✗ ${eng.message}`);
  if (!eng.success)
    allOk = false;
  spin.start("Verificando configuración...");
  await Promise.resolve().then(() => init_config());
  const cfg = patchOpenCodeConfig(resolvedProjectRoot);
  spin.stop(cfg.success ? `✓ ${cfg.message}` : `✗ ${cfg.message}`);
  if (!cfg.success)
    allOk = false;
  if (!allOk) {
    v2.warn("Algunos componentes requieren atención. Revisá los mensajes de error arriba.");
  }
  try {
    const gi = ensureGitignore(resolvedProjectRoot);
    if (gi.created)
      v2.info(`.gitignore creado con patrones Ostacky`);
    else if (gi.updated)
      v2.info(`.gitignore actualizado: ${gi.patternsAdded.join(", ")}`);
  } catch {}
  return allOk;
}
async function doInstallAll(manifest, paths) {
  const spin = L2();
  let errors = 0;
  v2.info(`Scope → local | opencodeDir: ${paths.root} | tools: ${paths.tools}`);
  ensureToolDirs(paths.tools, ["codegraph", "engram"]);
  for (const agent of manifest.agents) {
    spin.start(`Descargando agente: ${agent.name}  (${agent.version})`);
    try {
      await installAgent(agent, manifest, paths);
      spin.stop(`Agente instalado: ${agent.name}  (${agent.version})`);
    } catch (e) {
      spin.stop(`Error en ${agent.name}: ${e.message}`);
      errors++;
    }
  }
  for (const cmd of manifest.commands) {
    spin.start(`Descargando command: ${cmd.name}  (${cmd.version})`);
    try {
      await installCommand(cmd, manifest, paths);
      spin.stop(`Command instalado: ${cmd.name}  (${cmd.version})`);
    } catch (e) {
      spin.stop(`Error en ${cmd.name}: ${e.message}`);
      errors++;
    }
  }
  for (const skill of manifest.skills ?? []) {
    spin.start(`Instalando skill: ${skill.name}  (${skill.version})`);
    try {
      await installSkill(skill, manifest, paths);
      spin.stop(`Skill instalada: ${skill.name}  (${skill.version})`);
    } catch (e) {
      spin.stop(`Error en ${skill.name}: ${e.message}`);
      errors++;
    }
  }
  const pruned = pruneStaleSkills(paths, manifest);
  if (pruned.length > 0) {
    v2.info(`Skills obsoletas removidas: ${pruned.join(", ")}`);
  }
  for (const mcp of manifest.mcpServers ?? []) {
    spin.start(`Instalando MCP server: ${mcp.name}  (${mcp.version})`);
    try {
      await installMcpServer(mcp, manifest, paths);
      spin.stop(`MCP server instalado: ${mcp.name}  (${mcp.version})`);
    } catch (e) {
      spin.stop(`Error en ${mcp.name}: ${e.message}`);
      errors++;
    }
  }
  try {
    const { copyFileSync, mkdirSync, existsSync, rmSync } = await import("fs");
    const { join } = await import("path");
    await Promise.resolve().then(() => init_github());
    const { findProjectRoot } = await Promise.resolve().then(() => (init_fs(), {}));
    const src = join(PACKAGE_ROOT, "assets", "plugins", "ostacky-plugin.ts");
    const dest = join(paths.plugins, "ostacky-plugin.ts");
    if (existsSync(src)) {
      mkdirSync(paths.plugins, { recursive: true });
      copyFileSync(src, dest);
    }
    for (const legacy of ["ostacky-guard.ts", "ostacky-controller.ts"]) {
      const lp = join(paths.plugins, legacy);
      if (existsSync(lp))
        try {
          rmSync(lp, { force: true });
        } catch {}
    }
    const srcEng = join(PACKAGE_ROOT, "assets", "plugins", "engram.ts");
    const destEng = join(paths.plugins, "engram.ts");
    if (existsSync(srcEng)) {
      mkdirSync(paths.plugins, { recursive: true });
      copyFileSync(srcEng, destEng);
    }
  } catch {}
  let stackOk = true;
  let missingTools = [];
  v2.info("Instalando stack de herramientas...");
  stackOk = await doInstallStack(paths.tools, dirname6(paths.root));
  if (!stackOk)
    errors++;
  const codegraphDir = join8(paths.tools, "codegraph");
  const engramDir = join8(paths.tools, "engram");
  if (!existsSync7(codegraphDir) || !findBinaryInDir(codegraphDir, "codegraph"))
    missingTools.push("CodeGraph");
  if (!existsSync7(engramDir) || !findBinaryInDir(engramDir, "engram"))
    missingTools.push("Engram");
  if (missingTools.length > 0) {
    v2.warn(`Faltan herramientas del stack: ${missingTools.join(", ")}.
` + "Ejecutá `/install-stack` desde el agente para instalarlas manualmente.");
  }
  if (errors === 0 && stackOk && missingTools.length === 0) {
    v2.success("Todo instalado correctamente.");
  } else {
    v2.warn(`Instalación parcial: ${errors} componente(s) requieren atención.`);
  }
  try {
    const projectRoot = dirname6(paths.root);
    const gi = ensureGitignore(projectRoot);
    if (gi.created)
      v2.info(`.gitignore creado con patrones Ostacky`);
    else if (gi.updated)
      v2.info(`.gitignore actualizado: ${gi.patternsAdded.join(", ")}`);
  } catch {}
  return errors === 0 && stackOk && missingTools.length === 0;
}

// src/prompts/add.ts
init_lockfile();
async function doAddAgent(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  const options = manifest.agents.map((a) => {
    const installed = getInstalledVersion(lockfile, "agents", a.name);
    const hint = installed ? `v${installed} instalado — ${a.description}` : a.description;
    return { value: a.name, label: `${a.name}  (v${a.version})`, hint };
  });
  const selected = await pe({
    message: "¿Qué agentes deseas instalar?",
    options,
    required: true
  });
  onCancel(selected);
  const spin = L2();
  for (const name of selected) {
    const item = manifest.agents.find((a) => a.name === name);
    spin.start(`Descargando agente: ${name}  (${item.version})`);
    try {
      await installAgent(item, manifest, paths);
      spin.stop(`Agente instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${e.message}`);
    }
  }
}
async function doAddCommand(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  const options = manifest.commands.map((c) => {
    const installed = getInstalledVersion(lockfile, "commands", c.name);
    const hint = installed ? `v${installed} instalado — ${c.description}` : c.description;
    return { value: c.name, label: `${c.name}  (v${c.version})`, hint };
  });
  const selected = await pe({
    message: "¿Qué commands deseas instalar?",
    options,
    required: true
  });
  onCancel(selected);
  const spin = L2();
  for (const name of selected) {
    const item = manifest.commands.find((c) => c.name === name);
    spin.start(`Descargando command: ${name}  (${item.version})`);
    try {
      await installCommand(item, manifest, paths);
      spin.stop(`Command instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${e.message}`);
    }
  }
}
async function doAddSkill(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  const options = (manifest.skills ?? []).map((s) => {
    const installed = getInstalledVersion(lockfile, "skills", s.name);
    const hint = installed ? `v${installed} instalado — ${s.description}` : s.description;
    return { value: s.name, label: `${s.name}  (v${s.version})`, hint };
  });
  if (options.length === 0) {
    v2.info("No hay skills disponibles en el manifest.");
    return;
  }
  const selected = await pe({
    message: "¿Qué skills deseas instalar?",
    options,
    required: true
  });
  onCancel(selected);
  const spin = L2();
  for (const name of selected) {
    const item = manifest.skills.find((s) => s.name === name);
    spin.start(`Instalando skill: ${name}  (${item.version})`);
    try {
      await installSkill(item, manifest, paths);
      spin.stop(`Skill instalada: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${e.message}`);
    }
  }
}
async function doAddMcp(manifest, paths) {
  const lockfile = readLockfile(paths.root);
  const options = (manifest.mcpServers ?? []).map((m) => {
    const installed = getInstalledVersion(lockfile, "mcpServers", m.name);
    const hint = installed ? `v${installed} instalado — ${m.description}` : m.description;
    return { value: m.name, label: `${m.name}  (v${m.version})`, hint };
  });
  if (options.length === 0) {
    v2.info("No hay MCP servers disponibles en el manifest.");
    return;
  }
  const selected = await pe({
    message: "¿Qué MCP servers deseas instalar?",
    options,
    required: true
  });
  onCancel(selected);
  const spin = L2();
  for (const name of selected) {
    const item = manifest.mcpServers?.find((m) => m.name === name);
    if (!item)
      continue;
    spin.start(`Instalando MCP server: ${name}  (${item.version})`);
    try {
      await installMcpServer(item, manifest, paths);
      spin.stop(`MCP server instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${e.message}`);
    }
  }
}

// src/prompts/update.ts
init_lockfile();
async function doUpdate(manifest, paths) {
  const candidates = getUpdateCandidates(manifest, paths);
  const orphans = getOrphanedItems(manifest, paths);
  if (orphans.length > 0) {
    const orphanLines = orphans.map((o) => {
      const kind = kindLabel(o.type);
      return `  ${kind.padEnd(8)} ${o.name.padEnd(24)} v${o.version} (ya no existe en el manifest)`;
    });
    v2.warn(`Items huérfanos detectados (ya no en manifest):`);
    ye(orphanLines.join(`
`), "Items huérfanos");
    const shouldClean = await me({
      message: `¿Eliminar ${orphans.length} item(s) huérfano(s) del lockfile? No se borran archivos, solo el registro.`
    });
    onCancel(shouldClean);
    if (shouldClean) {
      for (const o of orphans) {
        removeFromLockfile(paths.root, o.type, o.name);
      }
      v2.success(`${orphans.length} item(s) huérfano(s) limpiados del lockfile.`);
    }
  }
  if (candidates.length === 0) {
    if (orphans.length > 0) {
      v2.info("Lockfile limpiado. No hay actualizaciones disponibles.");
    } else {
      v2.info("Todo está al día. No hay actualizaciones disponibles.");
    }
    return;
  }
  const diffLines = candidates.map(({ type, item, installedVersion }) => {
    const kind = kindLabel(type);
    return `  ${kind.padEnd(8)} ${item.name.padEnd(24)} ${formatVersionDiff(installedVersion, item.version)}`;
  });
  ye(diffLines.join(`
`), "Actualizaciones disponibles");
  const confirm = await me({
    message: `¿Aplicar ${candidates.length} actualización(es)?`
  });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Actualización cancelada.");
    return;
  }
  const spin = L2();
  let updated = 0;
  for (const { type, item } of candidates) {
    spin.start(`Actualizando: ${item.name}  → ${item.version}`);
    try {
      if (type === "agents") {
        await installAgent(item, manifest, paths);
      } else if (type === "commands") {
        await installCommand(item, manifest, paths);
      } else if (type === "skills") {
        await installSkill(item, manifest, paths);
      } else {
        await installMcpServer(item, manifest, paths);
      }
      spin.stop(`Actualizado: ${item.name}  (${item.version})`);
      updated++;
    } catch (e) {
      spin.stop(`Error en ${item.name}: ${e.message}`);
    }
  }
  v2.success(`${updated} recurso(s) actualizado(s).`);
  const pruned = pruneStaleSkills(paths, manifest);
  if (pruned.length > 0) {
    v2.info(`Skills obsoletas removidas del filesystem: ${pruned.join(", ")}`);
  }
}

// src/prompts/uninstall.ts
import { join as join9 } from "path";
init_stack();
init_lockfile();
async function doUninstallTotal(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile || Object.keys(lockfile.agents).length === 0 && Object.keys(lockfile.commands).length === 0 && Object.keys(lockfile.skills ?? {}).length === 0 && Object.keys(lockfile.mcpServers ?? {}).length === 0) {
    v2.info("No hay nada instalado.");
    return;
  }
  const pathsToDelete = [];
  for (const name of Object.keys(lockfile.agents)) {
    pathsToDelete.push(join9(paths.agents, `${name}.md`));
  }
  for (const name of Object.keys(lockfile.commands)) {
    pathsToDelete.push(join9(paths.commands, `${name}.md`));
  }
  for (const name of Object.keys(lockfile.skills ?? {})) {
    pathsToDelete.push(join9(paths.skills, name));
  }
  for (const name of Object.keys(lockfile.mcpServers ?? {})) {
    pathsToDelete.push(join9(paths.mcp, name));
  }
  ye([`Scope: ${paths.root}`, ...pathsToDelete].join(`
`), `Se eliminarán ${pathsToDelete.length} item(s) trackeados en lockfile (safe-delete)`);
  const confirm = await me({
    message: `¿Confirmar desinstalación de ${pathsToDelete.length} item(s) en ${paths.root}?`
  });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Desinstalación cancelada.");
    return;
  }
  uninstallAll(paths);
  v2.success(`${pathsToDelete.length} item(s) eliminado(s) + plugins Ostacky-owned limpiados.`);
  const cleanEngram = await me({
    message: "¿Deseas remover la configuración de Engram del proyecto (mcp.engram)?"
  });
  onCancel(cleanEngram);
  if (cleanEngram) {
    const result = uninstallEngramConfig();
    if (result.success) {
      v2.success(result.message);
    } else {
      v2.warn(result.message);
    }
  }
}
async function doUninstallAgent(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    v2.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.agents);
  if (installed.length === 0) {
    v2.info("No hay agentes instalados.");
    return;
  }
  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.agents[name].version}`
  }));
  const selected = await pe({
    message: "¿Qué agentes querés desinstalar?",
    options,
    required: true
  });
  onCancel(selected);
  for (const name of selected) {
    const ok = uninstallAgent(name, paths);
    if (ok) {
      v2.success(`Agente eliminado: ${name}`);
    } else {
      v2.warn(`No se pudo eliminar el agente: ${name}`);
    }
  }
}
async function doUninstallCommand(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    v2.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.commands);
  if (installed.length === 0) {
    v2.info("No hay commands instalados.");
    return;
  }
  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.commands[name].version}`
  }));
  const selected = await pe({
    message: "¿Qué commands querés desinstalar?",
    options,
    required: true
  });
  onCancel(selected);
  for (const name of selected) {
    const ok = uninstallCommand(name, paths);
    if (ok) {
      v2.success(`Command eliminado: ${name}`);
    } else {
      v2.warn(`No se pudo eliminar el command: ${name}`);
    }
  }
}
async function doUninstallSkill(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    v2.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.skills ?? {});
  if (installed.length === 0) {
    v2.info("No hay skills instaladas.");
    return;
  }
  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.skills[name].version}`
  }));
  const selected = await pe({
    message: "¿Qué skills querés desinstalar?",
    options,
    required: true
  });
  onCancel(selected);
  for (const name of selected) {
    const ok = uninstallSkill(name, paths);
    if (ok) {
      v2.success(`Skill eliminada: ${name}`);
    } else {
      v2.warn(`No se pudo eliminar la skill: ${name}`);
    }
  }
}
async function doUninstallMcp(paths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    v2.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.mcpServers ?? {});
  if (installed.length === 0) {
    v2.info("No hay MCP servers instalados.");
    return;
  }
  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.mcpServers?.[name]?.version ?? "?"}`
  }));
  const selected = await pe({
    message: "¿Qué MCP servers querés desinstalar?",
    options,
    required: true
  });
  onCancel(selected);
  for (const name of selected) {
    const ok = uninstallMcpServer(name, paths);
    if (ok) {
      v2.success(`MCP server eliminado: ${name}`);
    } else {
      v2.warn(`No se pudo eliminar el MCP server: ${name}`);
    }
  }
}
async function doUninstall(paths) {
  const scope = await de({
    message: "¿Qué querés desinstalar?",
    options: [
      { value: "all", label: "Todo (agentes + commands + skills + MCPs)" },
      { value: "agent", label: "Solo un agente" },
      { value: "command", label: "Solo un command" },
      { value: "skill", label: "Solo una skill" },
      { value: "mcp", label: "Solo un MCP server" }
    ]
  });
  onCancel(scope);
  switch (scope) {
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
async function doUninstallAgentByName(name, paths) {
  try {
    await Promise.resolve().then(() => init_security());
    validateFilePath(`${name}.md`);
  } catch (e) {
    v2.warn(`Nombre inválido: ${e.message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !(name in lockfile.agents)) {
    v2.warn(`${name} no está instalado.`);
    return;
  }
  const filePath = join9(paths.agents, `${name}.md`);
  ye(filePath, `Se eliminará`);
  const confirm = await me({ message: `¿Borrar ${name}.md?` });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Cancelado.");
    return;
  }
  const ok = uninstallAgent(name, paths);
  if (ok) {
    v2.success(`Agente eliminado: ${name}`);
  } else {
    v2.warn(`No se pudo eliminar el agente: ${name}`);
  }
}
async function doUninstallCommandByName(name, paths) {
  try {
    await Promise.resolve().then(() => init_security());
    validateFilePath(`${name}.md`);
  } catch (e) {
    v2.warn(`Nombre inválido: ${e.message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !(name in lockfile.commands)) {
    v2.warn(`${name} no está instalado.`);
    return;
  }
  const filePath = join9(paths.commands, `${name}.md`);
  ye(filePath, `Se eliminará`);
  const confirm = await me({ message: `¿Borrar ${name}.md?` });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Cancelado.");
    return;
  }
  const ok = uninstallCommand(name, paths);
  if (ok) {
    v2.success(`Command eliminado: ${name}`);
  } else {
    v2.warn(`No se pudo eliminar el command: ${name}`);
  }
}
async function doUninstallSkillByName(name, paths) {
  try {
    await Promise.resolve().then(() => init_security());
    validateFilePath(name);
  } catch (e) {
    v2.warn(`Nombre inválido: ${e.message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !lockfile.skills || !(name in lockfile.skills)) {
    v2.warn(`${name} no está instalado.`);
    return;
  }
  const dirPath = join9(paths.skills, name);
  ye(dirPath, `Se eliminará`);
  const confirm = await me({ message: `¿Borrar la skill "${name}"?` });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Cancelado.");
    return;
  }
  const ok = uninstallSkill(name, paths);
  if (ok) {
    v2.success(`Skill eliminada: ${name}`);
  } else {
    v2.warn(`No se pudo eliminar la skill: ${name}`);
  }
}
async function doUninstallMcpByName(name, paths) {
  try {
    await Promise.resolve().then(() => init_security());
    validateFilePath(name);
  } catch (e) {
    v2.warn(`Nombre inválido: ${e.message}`);
    return;
  }
  const lockfile = readLockfile(paths.root);
  if (!lockfile || !lockfile.mcpServers || !(name in lockfile.mcpServers)) {
    v2.warn(`${name} no está instalado.`);
    return;
  }
  const dirPath = join9(paths.mcp, name);
  ye(dirPath, `Se eliminará`);
  const confirm = await me({ message: `¿Borrar el MCP server "${name}"?` });
  onCancel(confirm);
  if (!confirm) {
    v2.info("Cancelado.");
    return;
  }
  const ok = uninstallMcpServer(name, paths);
  if (ok) {
    v2.success(`MCP server eliminado: ${name}`);
  } else {
    v2.warn(`No se pudo eliminar el MCP server: ${name}`);
  }
}

// src/opencode.ts
init_fs();
import { execSync, execFileSync as execFileSync4 } from "node:child_process";
function isOpencodeInstalled() {
  if (isCommandAvailable("opencode"))
    return true;
  try {
    execFileSync4("opencode", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function getOpencodeInstallCommand(platform = process.platform, _arch = process.arch) {
  if (platform === "win32") {
    return {
      display: "npm install -g opencode-ai",
      command: "npm",
      args: ["install", "-g", "opencode-ai"],
      note: "Alternativas Windows: choco install opencode | scoop install opencode | mise use -g github:anomalyco/opencode (ver https://opencode.ai/download). WSL recomendado."
    };
  }
  if (platform === "darwin") {
    return {
      display: "curl -fsSL https://opencode.ai/install | bash",
      command: "bash",
      args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
      note: "Alternativa macOS: brew install anomalyco/tap/opencode (tap oficial, más actualizado que brew install opencode)"
    };
  }
  return {
    display: "curl -fsSL https://opencode.ai/install | bash",
    command: "bash",
    args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
    note: "Alternativas Linux: npm install -g opencode-ai | bun add -g opencode-ai | brew install anomalyco/tap/opencode | paru -S opencode (Arch)"
  };
}
async function ensureOpencodeInstalled() {
  if (isOpencodeInstalled())
    return;
  const platform = process.platform;
  const info = getOpencodeInstallCommand(platform);
  v2.warn("OpenCode no detectado en este sistema.");
  ye(`${info.display}
Docs: https://opencode.ai/download${info.note ? `
${info.note}` : ""}`, `Instalación requerida (${platform})`);
  const shouldInstall = await me({
    message: "Ostacky no funciona sin OpenCode. ¿Querés instalar OpenCode ahora?",
    initialValue: true
  });
  if (BD(shouldInstall) || !shouldInstall) {
    fe("Instalación cancelada. Instalá OpenCode manualmente y volvé a ejecutar: https://opencode.ai/download");
    process.exit(1);
  }
  const spin = L2();
  spin.start(`Instalando OpenCode (${info.display})...`);
  try {
    if (platform === "win32") {
      execSync("npm install -g opencode-ai", { stdio: "inherit", shell: "cmd.exe" });
    } else {
      if (!isCommandAvailable("curl")) {
        spin.stop("curl no disponible");
        v2.warn("curl no está instalado — se intentará con npm como fallback.");
        execSync("npm install -g opencode-ai", { stdio: "inherit", shell: "/bin/bash" });
      } else {
        execSync("curl -fsSL https://opencode.ai/install | bash", { stdio: "inherit", shell: "/bin/bash" });
      }
    }
    spin.stop("Instalación ejecutada, verificando...");
  } catch (e) {
    spin.stop("Fallo la instalación automática.");
    const msg = e.message ?? String(e);
    v2.error(`No se pudo instalar OpenCode automáticamente: ${msg}`);
    if (platform === "win32") {
      ye([
        "Intentá manualmente una de estas opciones:",
        "  npm install -g opencode-ai",
        "  choco install opencode",
        "  scoop install opencode",
        "  (WSL) curl -fsSL https://opencode.ai/install | bash",
        "Luego verificá: opencode --version",
        "Docs: https://opencode.ai/download"
      ].join(`
`), "Acción manual requerida");
    } else {
      ye([
        "Intentá manualmente:",
        `  ${info.display}`,
        "  npm install -g opencode-ai  (si no tenés curl)",
        "  brew install anomalyco/tap/opencode  (macOS/Linux con brew)",
        "Luego verificá: opencode --version",
        "Docs: https://opencode.ai/download"
      ].join(`
`), "Acción manual requerida");
    }
    process.exit(1);
  }
  if (!isOpencodeInstalled()) {
    v2.error("OpenCode aún no está disponible en el PATH después de la instalación.");
    ye([
      "Probá cerrar y reabrir la terminal y ejecutar:",
      "  opencode --version",
      "Si persiste, instalá manualmente:",
      `  ${info.display}`,
      "Docs: https://opencode.ai/download"
    ].join(`
`), "Verificación falló");
    process.exit(1);
  }
  v2.success("OpenCode instalado correctamente ✓");
}

// src/prompts/index.ts
async function runInteractiveMenu(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Instalación cancelada.");
    return;
  }
  const action = await de({
    message: "¿Qué deseas hacer?",
    options: [
      { value: "all", label: "Instalar todo" },
      { value: "agent", label: "Instalar agente" },
      { value: "command", label: "Instalar command" },
      { value: "skill", label: "Instalar skill" },
      { value: "mcp", label: "Instalar MCP server" },
      { value: "stack", label: "Instalar stack de herramientas (CodeGraph, Engram)" },
      { value: "update", label: "Actualizar instalación" },
      { value: "uninstall", label: "Desinstalar" },
      { value: "exit", label: "Salir" }
    ]
  });
  onCancel(action);
  switch (action) {
    case "all":
      if (!await doInstallAll(manifest, paths))
        process.exitCode = 1;
      printPostInstallSteps();
      fe(process.exitCode ? "Instalación parcial." : "Listo.");
      break;
    case "agent":
      await doAddAgent(manifest, paths);
      printPostInstallSteps();
      fe("Listo.");
      break;
    case "command":
      await doAddCommand(manifest, paths);
      printPostInstallSteps();
      fe("Listo.");
      break;
    case "skill":
      await doAddSkill(manifest, paths);
      printPostInstallSteps();
      fe("Listo.");
      break;
    case "mcp":
      await doAddMcp(manifest, paths);
      printPostInstallSteps();
      fe("Listo.");
      break;
    case "stack": {
      ensureToolDirs(paths.tools, ["codegraph", "engram"]);
      const stackOk = await doInstallStack(paths.tools, dirname7(paths.root));
      if (!stackOk)
        process.exitCode = 1;
      fe(stackOk ? "Listo." : "Instalación parcial.");
      break;
    }
    case "update": {
      const latestManifest = await loadLatestManifest();
      await doUpdate(latestManifest, paths);
      fe("Listo.");
      break;
    }
    case "uninstall":
      await doUninstall(paths);
      fe("Listo.");
      break;
    case "exit":
      fe("Hasta luego.");
      break;
  }
}
async function runInstallCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  if (!await doInstallAll(manifest, paths))
    process.exitCode = 1;
  printPostInstallSteps();
  fe(process.exitCode ? "Instalación parcial." : "Instalación completada.");
}
async function runAddAgentCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doAddAgent(manifest, paths);
  printPostInstallSteps();
  fe("Listo.");
}
async function runAddCommandCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doAddCommand(manifest, paths);
  printPostInstallSteps();
  fe("Listo.");
}
async function runAddSkillCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doAddSkill(manifest, paths);
  printPostInstallSteps();
  fe("Listo.");
}
async function runAddMcpCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doAddMcp(manifest, paths);
  printPostInstallSteps();
  fe("Listo.");
}
async function runInstallStackCommand(scope) {
  await ensureOpencodeInstalled();
  we(" OpenCode Installer — Stack ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  ensureToolDirs(paths.tools, ["codegraph", "engram"]);
  const stackOk = await doInstallStack(paths.tools, dirname7(paths.root));
  if (!stackOk)
    process.exitCode = 1;
  fe(stackOk ? "Stack instalado." : "Stack instalado parcialmente.");
}
async function runUninstallStackCommand(scope) {
  we(" OpenCode Installer — Stack ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  const confirm = await me({
    message: "¿Remover la configuración del stack (CodeGraph, Engram) del proyecto? Los binarios globales no se tocan."
  });
  onCancel(confirm);
  if (!confirm) {
    fe("Cancelado.");
    return;
  }
  await Promise.resolve().then(() => init_stack());
  const result = uninstallStackConfig(paths);
  if (result.success) {
    v2.success(result.message);
  } else {
    v2.warn(result.message);
  }
  fe("Stack desinstalado.");
}
async function runUpdateCommand(scope) {
  we(" OpenCode Installer ");
  await ensureOpencodeInstalled();
  const manifest = await loadLatestManifest();
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doUpdate(manifest, paths);
  fe("Actualización completada.");
}
async function runUninstallCommand(scope) {
  we(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  await doUninstall(paths);
  fe("Desinstalación completada.");
}
async function runUninstallAgentCommand(name, scope) {
  we(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  if (name) {
    await doUninstallAgentByName(name, paths);
  } else {
    await Promise.resolve().then(() => init_lockfile());
    const lockfile = readLockfile(paths.root);
    if (lockfile && Object.keys(lockfile.agents).length > 0) {
      const prompts = exports_dist;
      const installed = Object.keys(lockfile.agents);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.agents[n].version}`
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué agentes querés desinstalar?",
        options,
        required: true
      });
      onCancel(selected);
      for (const n of selected) {
        await doUninstallAgentByName(n, paths);
      }
    } else {
      v2.info("No hay agentes instalados.");
    }
  }
  fe("Listo.");
}
async function runUninstallCommandCommand(name, scope) {
  we(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  if (name) {
    await doUninstallCommandByName(name, paths);
  } else {
    await Promise.resolve().then(() => init_lockfile());
    const lockfile = readLockfile(paths.root);
    if (lockfile && Object.keys(lockfile.commands).length > 0) {
      const prompts = exports_dist;
      const installed = Object.keys(lockfile.commands);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.commands[n].version}`
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué commands querés desinstalar?",
        options,
        required: true
      });
      onCancel(selected);
      for (const n of selected) {
        await doUninstallCommandByName(n, paths);
      }
    } else {
      v2.info("No hay commands instalados.");
    }
  }
  fe("Listo.");
}
async function runUninstallSkillCommand(name, scope) {
  we(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  if (name) {
    await doUninstallSkillByName(name, paths);
  } else {
    await Promise.resolve().then(() => init_lockfile());
    const lockfile = readLockfile(paths.root);
    if (lockfile && lockfile.skills && Object.keys(lockfile.skills).length > 0) {
      const prompts = exports_dist;
      const installed = Object.keys(lockfile.skills);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.skills[n].version}`
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué skills querés desinstalar?",
        options,
        required: true
      });
      onCancel(selected);
      for (const n of selected) {
        await doUninstallSkillByName(n, paths);
      }
    } else {
      v2.info("No hay skills instaladas.");
    }
  }
  fe("Listo.");
}
async function runUninstallMcpCommand(name, scope) {
  we(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths(scope ?? null);
  if (!paths) {
    fe("Cancelado.");
    return;
  }
  if (name) {
    await doUninstallMcpByName(name, paths);
  } else {
    await Promise.resolve().then(() => init_lockfile());
    const lockfile = readLockfile(paths.root);
    if (lockfile && lockfile.mcpServers && Object.keys(lockfile.mcpServers).length > 0) {
      const prompts = exports_dist;
      const installed = Object.keys(lockfile.mcpServers);
      const options = installed.map((n) => ({
        value: n,
        label: n,
        hint: `v${lockfile.mcpServers?.[n]?.version ?? "?"}`
      }));
      const selected = await prompts.multiselect({
        message: "¿Qué MCP servers querés desinstalar?",
        options,
        required: true
      });
      onCancel(selected);
      for (const n of selected) {
        await doUninstallMcpByName(n, paths);
      }
    } else {
      v2.info("No hay MCP servers instalados.");
    }
  }
  fe("Listo.");
}

// src/cli.ts
init_fs();
import { existsSync as existsSync8, statSync as statSync3, readFileSync as readFileSync6, readdirSync as readdirSync3 } from "node:fs";
import { join as join10, dirname as dirname8 } from "node:path";
var HELP = `
ostacky — Instalador de agentes, comandos, skills y MCPs para OpenCode

Uso:
  npx ostacky [--scope local]                    Menú interactivo (instalación completa, siempre local)
  npx ostacky install [--scope local]            Instalar TODO (agente + skills + MCPs + CodeGraph + OpenSpec + Engram)
  npx ostacky add agent [--scope local]          Agregar agente(s)
  npx ostacky add command [--scope local]        Agregar command(s)
  npx ostacky add skill [--scope local]          Agregar skill(s)
  npx ostacky add mcp [--scope local]            Agregar MCP server(s)
  npx ostacky install-stack [--scope local]      Instalar solo el stack de herramientas (CodeGraph, OpenSpec, Engram)
  npx ostacky uninstall-stack [--scope local]    Remover la configuración del stack del proyecto
  npx ostacky doctor                           Diagnostica locks, tools, state health
  npx ostacky status [--json]                  Muestra estado del controller sin MCP
  npx ostacky update [--scope local]             Actualizar instalación
  npx ostacky uninstall [--scope local]          Desinstalar todo
  npx ostacky uninstall agent [--scope local]    Desinstalar agente(s)
  npx ostacky uninstall command [--scope local]  Desinstalar command(s)
  npx ostacky uninstall skill [--scope local]    Desinstalar skill(s)
  npx ostacky uninstall mcp [--scope local]      Desinstalar MCP server(s)
  npx ostacky --help             Mostrar esta ayuda
  npx ostacky --version          Mostrar versión

Scope:
  --scope local   Escribe en <proyecto>/.opencode (siempre local, instalador único)
  Sin flag        Asume local implícito (no pregunta global)
`.trim();
function parseScopeArg(argv = process.argv) {
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope" && i + 1 < argv.length) {
      const v = argv[i + 1];
      if (v === "local")
        return v;
      if (v === "global" || v === "auto") {
        console.error(`Error: --scope ${v} removido; Ostacky instala siempre local en <proyecto>/.opencode. Hacé cd al proyecto y re-ejecutá con --scope local.`);
        process.exit(1);
      }
    }
    if (arg.startsWith("--scope=")) {
      const v = arg.split("=")[1];
      if (v === "local")
        return v;
      if (v === "global" || v === "auto") {
        console.error(`Error: --scope ${v} removido; Ostacky instala siempre local en <proyecto>/.opencode. Hacé cd al proyecto y re-ejecutá con --scope local.`);
        process.exit(1);
      }
    }
  }
  return null;
}
function withoutScopeArgs(argv) {
  const out = [];
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope" && i + 1 < argv.length) {
      i++;
      continue;
    }
    if (arg.startsWith("--scope="))
      continue;
    out.push(arg);
  }
  return out;
}
var scope = parseScopeArg();
var argvNoScope = withoutScopeArgs(process.argv);
var [, , cmd, subcmd] = argvNoScope;
async function runDoctorCommand() {
  const cwd = process.cwd();
  const opencodeDir = findOpenCodeDir(cwd) || join10(cwd, ".opencode");
  const statePath = join10(opencodeDir, "ostacky-state.json");
  let hasError = false;
  let hasWarn = false;
  const check = (label, ok, warn = false) => {
    if (ok)
      console.log(`✅ ${label}: OK`);
    else if (warn) {
      console.log(`⚠️ ${label}`);
      hasWarn = true;
    } else {
      console.log(`❌ ${label}`);
      hasError = true;
    }
  };
  const pluginPaths = [
    join10(cwd, "assets", "plugins", "ostacky-plugin.ts"),
    join10(opencodeDir, "plugins", "ostacky-plugin.ts"),
    join10(cwd, ".opencode", "plugins", "ostacky-plugin.ts"),
    join10(cwd, "assets", "plugins", "ostacky-controller.ts"),
    join10(opencodeDir, "plugins", "ostacky-controller.ts"),
    join10(cwd, ".opencode", "plugins", "ostacky-controller.ts")
  ];
  const pluginActive = pluginPaths.some((p) => existsSync8(p));
  try {
    if (!existsSync8(statePath)) {
      if (pluginActive)
        console.log(`✅ controller: plugin active (no state yet)`);
      else
        check("controller: state file missing", false, true);
    } else {
      const stat = statSync3(statePath);
      const raw = readFileSync6(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (pluginActive) {
        console.log(`✅ controller: plugin active (rev ${parsed.revision || 0} state ${parsed.state || "unknown"})`);
      } else {
        check(`controller: OK (rev ${parsed.revision || 0} state ${parsed.state || "unknown"})`, true);
      }
      if (parsed.degraded) {
        console.log("⚠️ degraded: true (persistido)");
        hasWarn = true;
      }
      if (parsed.degradedEditsCount > 0)
        console.log(`⚠️ degraded: confirmation not audited in controller (degradedEditsCount=${parsed.degradedEditsCount})`);
      if (parsed.codegraphBypassCount > 0)
        console.log(`⚠️ codegraphBypassCount=${parsed.codegraphBypassCount} (inefficient: codegraph bypass)`);
      if (parsed.engramBypassCount > 0)
        console.log(`⚠️ engramBypassCount=${parsed.engramBypassCount} (contradiction check bypassed — sin mem_search)`);
      if (parsed.stateOversizedCount > 0)
        console.log(`⚠️ stateOversizedCount=${parsed.stateOversizedCount} snapshots perdidos`);
      if (parsed.sensitiveAccess)
        console.log(`ℹ️ sensitiveAccess: allowed=${parsed.sensitiveAccess.allowed || 0} denied=${parsed.sensitiveAccess.denied || 0} blocked=${parsed.sensitiveAccess.blockedAttempts || 0}`);
      if (parsed.sensitivePatterns)
        console.log(`ℹ️ sensitivePatterns: ${parsed.sensitivePatterns.join(", ")}`);
      if (parsed.allowedFiles && Object.keys(parsed.allowedFiles).length)
        console.log(`ℹ️ allowedFiles: ${Object.keys(parsed.allowedFiles).join(", ")}`);
      if (parsed.deniedFiles && Object.keys(parsed.deniedFiles).length) {
        console.log(`ℹ️ denied files: ${Object.keys(parsed.deniedFiles).join(", ")} (denied by user)`);
      }
      if (parsed.staleContentAttempts > 0)
        console.log(`⚠️ staleContentAttempts=${parsed.staleContentAttempts}`);
      if (parsed.completeWithoutValidateCount > 0)
        console.log(`⚠️ completeWithoutValidateCount=${parsed.completeWithoutValidateCount}`);
      if (stat.size > 2 * 1024 * 1024) {
        console.log("⚠️ state file >2MB (oversized)");
        hasWarn = true;
      }
      const auditSize = (parsed.audit || []).length;
      if (auditSize > 500)
        console.log(`⚠️ audit large: ${auditSize}`);
      try {
        const { statfsSync } = await import("node:fs");
        if (typeof statfsSync === "function") {
          const s = statfsSync(dirname8(statePath));
          const freeMB = Math.floor(s.bfree * s.bsize / 1048576);
          if (freeMB < 100) {
            console.log(`⚠️ Disco casi lleno: ${freeMB}MB libres`);
            hasWarn = true;
          } else
            console.log(`ℹ️ diskFreeMB: ${freeMB}`);
        }
      } catch {}
      if ((parsed.state === "EXECUTING_INLINE" || parsed.state === "EXECUTING_SUBAGENTS") && parsed.expectedTasks) {
        const pending = parsed.expectedTasks.filter((id) => !parsed.tasks?.[id] || parsed.tasks[id].status !== "COMPLETED").length;
        const lastHandoffAge = parsed.lastHandoff ? Date.now() - parsed.lastHandoff.ts : Infinity;
        if (pending === 0 && lastHandoffAge > 60000) {
          console.log("⚠️ EXECUTING_* con pending==0 y lastHandoff >60s sin progreso — sugerir implementation_complete manual");
          hasWarn = true;
        }
      }
    }
  } catch (e) {
    check(`controller: ${e.message}`, false);
  }
  try {
    const lockPid = join10(opencodeDir, "ostacky-state.json.lock.pid");
    const lockTs = join10(opencodeDir, "ostacky-state.json.lock.timestamp");
    if (existsSync8(lockPid) || existsSync8(lockTs)) {
      let ageStr = "";
      try {
        const ts = parseInt(readFileSync6(lockTs, "utf-8"), 10);
        const age = Date.now() - ts;
        ageStr = `${Math.floor(age / 1000)}s`;
        const pid = readFileSync6(lockPid, "utf-8").trim();
        let alive = false;
        try {
          process.kill(parseInt(pid, 10), 0);
          alive = true;
        } catch {}
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
  const tools = ["codegraph", "engram"];
  for (const t of tools) {
    const p = join10(opencodeDir, "tools", t, "bin", t);
    const pExe = p + ".exe";
    check(`tool ${t}: ${existsSync8(p) || existsSync8(pExe) ? "found" : "missing"}`, existsSync8(p) || existsSync8(pExe), true);
  }
  try {
    const manifest = JSON.parse(readFileSync6(join10(cwd, "manifest.json"), "utf-8"));
    const expected = manifest.mcpServers?.find((x) => x.name === "ostacky-controller")?.sha256;
    if (expected) {
      const actual = computeTreeHash(join10(cwd, "assets", "mcp", "ostacky-controller"));
      check(`manifest hash: ${expected.slice(0, 8)} vs actual ${actual.slice(0, 8)}`, expected === actual);
      if (expected !== actual)
        console.log("  Run: bun run hash:update");
    }
  } catch {
    check("manifest: not found", false, true);
  }
  if (existsSync8(statePath)) {
    try {
      const s = JSON.parse(readFileSync6(statePath, "utf-8"));
      if (s.allowedFiles || s.deniedFiles) {}
    } catch {}
  }
  try {
    const cacheDir = join10(opencodeDir, "cache", "codegraph");
    if (!existsSync8(cacheDir)) {
      console.log("ℹ️ cache: no cache dir yet (ok)");
    } else {
      const files = readdirSync3(cacheDir);
      let total = 0;
      for (const f of files) {
        try {
          total += statSync3(join10(cacheDir, f)).size;
        } catch {}
      }
      const totalMB = (total / 1048576).toFixed(2);
      if (total > 52428800) {
        console.log(`⚠️ cache: ${totalMB}MB >50MB — LRU cleanup needed`);
        hasWarn = true;
      } else {
        console.log(`✅ cache: OK (${files.length} files, ${totalMB}MB)`);
      }
      try {
        const s = JSON.parse(readFileSync6(statePath, "utf-8"));
        if (s.cacheHitCount !== undefined) {
          console.log(`ℹ️ cacheHitCount=${s.cacheHitCount} cacheMissCount=${s.cacheMissCount || 0} tokenSavingEstimate=${s.tokenSavingEstimate || 0}`);
        }
      } catch {}
    }
  } catch (e) {
    console.log(`⚠️ cache: check failed ${e.message}`);
  }
  try {
    const coreSrc = join10(cwd, "src", "controller-core.ts");
    const coreMcp = join10(cwd, "assets", "mcp", "ostacky-controller", "controller-core.js");
    const corePlugin = join10(cwd, "assets", "plugins", "controller-core.ts");
    const coreSync = existsSync8(coreSrc) && existsSync8(coreMcp) && existsSync8(corePlugin);
    if (coreSync) {
      const srcHash = readFileSync6(coreSrc, "utf-8").slice(0, 100);
      const mcpHash = readFileSync6(coreMcp, "utf-8").slice(0, 100);
      const ok = readFileSync6(coreMcp, "utf-8").includes("STATES") && readFileSync6(corePlugin, "utf-8").includes("STATES");
      check(`controller-core: synced (${ok ? "STATES present" : "mismatch"})`, ok);
      if (!ok)
        console.log("  Run: bun run scripts/sync-controller-core.ts (if exists) or copy src/controller-core.ts");
    } else {
      check("controller-core: synced", false, true);
    }
    const auditPath = join10(opencodeDir, "ostacky-audit.jsonl");
    if (existsSync8(auditPath)) {
      const sz = statSync3(auditPath).size;
      const lines = readFileSync6(auditPath, "utf-8").split(`
`).filter(Boolean).length;
      check(`audit: jsonl ${lines} entries, ${(sz / 1024).toFixed(1)}KB`, sz < 512000);
      if (existsSync8(statePath)) {
        const s = JSON.parse(readFileSync6(statePath, "utf-8"));
        const stateSize = statSync3(statePath).size;
        check(`state size <50KB (${(stateSize / 1024).toFixed(1)}KB)`, stateSize < 51200);
        if (s.audit && s.audit.length > 20)
          console.log(`⚠️ state.audit large: ${s.audit.length} (should be tail only, full in jsonl)`);
        else if (s.auditTail)
          console.log(`✅ state.auditTail: ${s.auditTail.length} (jsonl primary)`);
      }
    } else {
      console.log("ℹ️ audit: jsonl not yet created (will be created on next audit)");
    }
    const ostackyMd = readFileSync6(join10(cwd, "assets", "agents", "ostacky.md"), "utf-8");
    const hasLevels = ostackyMd.includes("LEVEL_THRESHOLDS") || ostackyMd.includes("classifyLevel");
    check("levels: unified via tiered.ts", hasLevels, true);
    const hasHonesty = ostackyMd.includes("Principios de honestidad");
    check("honesty: 7 SHALL", hasHonesty);
    if (!hasHonesty)
      console.log("  Expected: ## Principios de honestidad (SHALL) in ostacky.md");
    const pluginPath = join10(cwd, "assets", "plugins", "ostacky-plugin.ts");
    if (existsSync8(pluginPath)) {
      const plugin = readFileSync6(pluginPath, "utf-8");
      const hasSpecGuard = plugin.includes("getDiscoverySnapshot") && plugin.includes("specSnapshot");
      const hasNoOverwrite = plugin.includes("No edites sin Read fresco") || plugin.includes("specSnapshot");
      check("spec: no-overwrite guard", hasNoOverwrite, true);
    }
    const hasSyncProactive = ostackyMd.includes("Noté que lo que acordamos");
    check("sync: proactive WARN", hasSyncProactive, true);
  } catch (e) {
    console.log(`⚠️ honesty/spec checks failed: ${e.message}`);
  }
  try {
    const giPath = join10(cwd, ".gitignore");
    if (!existsSync8(giPath)) {
      console.log("⚠️ .gitignore: missing (run npx ostacky install --scope local to create)");
      hasWarn = true;
    } else {
      const gi = readFileSync6(giPath, "utf-8");
      const needed = [
        ".opencode/tools/",
        ".opencode/cache/",
        ".opencode/ostacky-state.json",
        ".codegraph/",
        "openspec/"
      ];
      const missing = needed.filter((p) => !gi.includes(p));
      if (missing.length > 0) {
        console.log(`⚠️ .gitignore: missing ${missing.join(", ")} — run npx ostacky install to regenerate`);
        hasWarn = true;
      } else {
        console.log("✅ .gitignore: OK (covers .opencode/tools/, cache, state, .codegraph/, openspec/)");
      }
      if (!gi.includes("# Ostacky"))
        console.log("ℹ️ .gitignore: missing # Ostacky header");
    }
  } catch {}
  try {
    const secPath = join10(cwd, "src", "security.ts");
    if (!existsSync8(secPath)) {
      console.log("⚠️ src/security.ts: missing (source-of-truth)");
      hasWarn = true;
    } else {
      const sec = readFileSync6(secPath, "utf-8");
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
  try {
    const s = JSON.parse(readFileSync6(statePath, "utf-8"));
    if (s.sensitiveAccess?.blockedAttempts > 0) {
      console.log(`ℹ️ sensitiveAccess: blockedAttempts includes bash (${s.sensitiveAccess.blockedAttempts})`);
    }
  } catch {}
  if (hasError)
    process.exit(1);
  if (hasWarn)
    process.exit(0);
}
async function runStatusCommand(args) {
  const isJson = args.includes("--json");
  const cwd = process.cwd();
  const opencodeDir = findOpenCodeDir(cwd) || join10(cwd, ".opencode");
  const statePath = join10(opencodeDir, "ostacky-state.json");
  if (!existsSync8(statePath)) {
    console.log(isJson ? JSON.stringify({ error: "no state" }) : "No state file");
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync6(statePath, "utf-8"));
    const completed = Object.values(parsed.tasks || {}).filter((t) => t.status === "COMPLETED").length;
    const expected = parsed.expectedTaskCount ?? parsed.expectedTasks?.length ?? Object.keys(parsed.tasks || {}).length;
    const degraded = parsed.degraded ? " degraded" : "";
    const lastHandoff = parsed.lastHandoff ? ` lastHandoff: ${parsed.lastHandoff.summary?.slice(0, 60)}` : "";
    if (isJson) {
      console.log(JSON.stringify({
        state: parsed.state,
        revision: parsed.revision,
        degraded: !!parsed.degraded,
        tasks: `${completed}/${expected}`,
        lastHandoff: parsed.lastHandoff
      }, null, 2));
    } else {
      console.log(`${parsed.state} rev ${parsed.revision}${degraded} tasks ${completed}/${expected}${lastHandoff}`);
      if (parsed.lastProposal)
        console.log(`lastProposal: ${parsed.lastProposal.summary} shownToUser=${parsed.lastProposal.shownToUser}`);
    }
  } catch (e) {
    console.log(`Error reading state: ${e.message}`);
  }
}
async function main() {
  const needsOpencode = !cmd || cmd === "install" || cmd === "install-stack" || cmd === "update" || cmd === "add" && ["agent", "command", "skill", "mcp"].includes(subcmd ?? "");
  if (needsOpencode) {
    await ensureOpencodeInstalled();
  }
  switch (cmd) {
    case "install":
      await runInstallCommand(scope);
      break;
    case "install-stack":
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
        console.error(`Subcomando desconocido: "${subcmd}". Usa 'agent', 'command', 'skill', 'mcp' o nada.`);
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
      console.log(package_default.version);
      break;
    default:
      if (cmd) {
        console.error(`Comando desconocido: "${cmd}". Usá --help para ver los comandos disponibles.`);
        process.exit(1);
      }
      await runInteractiveMenu(scope);
  }
}
main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
