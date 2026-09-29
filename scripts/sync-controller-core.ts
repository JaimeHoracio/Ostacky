#!/usr/bin/env bun
/**
 * sync-controller-core — Single source of truth: src/ -> mirrors en assets/
 *
 * Canónico: src/controller-core.ts, src/security.ts, src/tiered.ts
 * Mirrors:
 *   src/controller-core.ts -> assets/plugins/ostacky-controller/controller-core.ts (TS verbatim)
 *   src/controller-core.ts -> assets/mcp/ostacky-controller/controller-core.js (JS stripped)
 *   src/security.ts        -> assets/plugins/ostacky-controller/security.ts (TS verbatim)
 *   src/security.ts        -> assets/mcp/ostacky-controller/security.js (JS stripped)
 *   src/tiered.ts          -> assets/plugins/ostacky-controller/tiered.ts (TS verbatim)
 *
 * Mantiene sincronizado via `bun run scripts/sync-controller-core.ts` y verifica con `--check`.
 * Llamado desde `prebuild` (sync-version + sync-controller-core).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(join(dirname(scriptPath), ".."));

function stripTsToJs(content: string, sourceHeader: string): string {
  let out = content;
  // Header: replace TS canonical header with JS generated header
  out = out.replace(
    /\/\*\*\n \* controller-core — Single source of truth[^\*]*\*\/\n/,
    `/**\n * controller-core — Single source of truth para TRANSITIONS, STATES, DEFAULT_STATE y helpers.\n * Generado desde src/controller-core.ts — NO EDITAR. Ejecutá \`bun run scripts\\/sync-controller-core.ts\`.\n */\n\n`
  );
  out = out.replace(
    /\/\*\*\n \* security\.js — source-of-truth mirror[^\*]*\*\/\n/,
    `/**\n * security.js — source-of-truth mirror of src/security.ts for controller (Node)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts\\/sync-controller-core.ts\`.\n */\n\n`
  );
  // Generic: add generated header if missing
  if (!out.includes("Generado desde src/")) {
    out = `/**\n * Generado desde ${sourceHeader} — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n` + out;
  }
  // Strip type imports like `import { createHash } from "crypto";` stays
  // Remove type-only imports: `import type` already ok, but ensure JS
  // Transformations specific to controller-core
  out = out.replace(/: Record<string, Array<\{ via: string; to: string; choice\?: string; mode\?: string \}>>/g, "");
  out = out.replace(/: any/g, "");
  out = out.replace(/: string\[\]/g, "");
  out = out.replace(/: string/g, "");
  out = out.replace(/: number/g, "");
  out = out.replace(/: boolean/g, "");
  out = out.replace(/: void/g, "");
  out = out.replace(/\bpretty = false\b/g, "pretty = false");
  out = out.replace(/ as const/g, "");
  // Remove leftover type params on functions: `Array<{ ... }>` already stripped, but keep generics like `WeakSet` without type
  out = out.replace(/<[^>]+>/g, (m) => {
    // Keep <string> in comments? Only strip simple type generics that are TS-only
    // For JS, `new WeakSet()` is fine without <any>. So strip all <...>
    // But be careful with `<T>` in code that is actually comparison. In our files, all `<...>` are types.
    return "";
  });
  // Fix `new WeakSet()` was `new WeakSet()` ok
  // Remove `type` keyword leaks
  out = out.replace(/\)\s*:\s*\{/g, ") {");
  // Clean double spaces
  out = out.replace(/ +/g, " ");
  // But restore some formatting: ensure `=>` spacing ok
  return out;
}

function jsFromSecurityTs(content: string): string {
  let out = content;
  // Replace header
  out = out.replace(
    /import \{ createHash \} from "crypto";/,
    `/**\n * security.js — source-of-truth mirror of src/security.ts for controller (Node)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts\\/sync-controller-core.ts\`.\n */\n\nexport const SENSITIVE_DEFAULT = [`
  );
  // Actually, easier: rebuild from scratch using src content but stripped
  // We'll just strip types generically
  out = content;
  // Header
  if (!out.includes("Generado desde src/security.ts")) {
    out = out.replace(
      /^import \{ createHash \} from "crypto";/m,
      `/**\n * security.js — source-of-truth mirror of src/security.ts for controller (Node)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts\\/sync-controller-core.ts\`.\n */\n\nimport { createHash } from "crypto";`
    );
  }
  out = out.replace(/: string\[\]/g, "");
  out = out.replace(/: string/g, "");
  out = out.replace(/: boolean/g, "");
  out = out.replace(/: void/g, "");
  out = out.replace(/: number/g, "");
  out = out.replace(/\|\s*null\s*\|\s*undefined/g, "");
  out = out.replace(/\| null/g, "");
  out = out.replace(/\| undefined/g, "");
  out = out.replace(/ as const/g, "");
  out = out.replace(/<[^>]+>/g, "");
  out = out.replace(/: any/g, "");
  // Remove type defaults like `patterns = SENSITIVE_DEFAULT` stays, but `patterns: string[] =` -> `patterns =`
  out = out.replace(/patterns: string\[\] =/g, "patterns =");
  out = out.replace(/filePath: string/g, "filePath");
  out = out.replace(/cmd: string/g, "cmd");
  // Clean
  out = out.replace(/ +/g, " ");
  return out;
}

// More precise: we will use simple copy for TS mirrors and regex strip for JS
function tsToJsMinimal(tsContent: string, isController: boolean): string {
  let js = tsContent;
  // Add generated header if not present
  const headerController = `/**\n * controller-core — Single source of truth para TRANSITIONS, STATES, DEFAULT_STATE y helpers.\n * Generado desde src/controller-core.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n`;
  const headerSecurity = `/**\n * security.js — source-of-truth mirror of src/security.ts for controller (Node)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n`;

  if (isController) {
    // Remove existing header block and prepend generated one
    js = js.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "");
    js = headerController + js;
    // Strip types
    js = js.replace(/: Record<string, Array<\{ via: string; to: string; choice\?: string; mode\?: string \}>>/g, "");
    js = js.replace(/: any/g, "");
    js = js.replace(/: string\[\]/g, "");
    js = js.replace(/: string/g, "");
    js = js.replace(/: number/g, "");
    js = js.replace(/: boolean/g, "");
    js = js.replace(/ as const/g, "");
    // Remove generic type params like <any> after WeakSet
    js = js.replace(/new WeakSet\(\)/g, "new WeakSet()");
    js = js.replace(/WeakSet<any>/g, "WeakSet");
    // Clean function signatures
    js = js.replace(/\(obj: any, pretty = false\): string/g, "(obj, pretty = false)");
    js = js.replace(/\(data: any\): any/g, "(data)");
    js = js.replace(/\(obj: any\)/g, "(obj)");
    js = js.replace(/\(e: any\)/g, "(e)");
    js = js.replace(/\(\)\s*:\s*number/g, "()");
    // Remove leftover `Object.freeze({...} as const)` already handled
    // Remove type annotations on params with default values
    js = js.replace(/(\w+): string =/g, "$1 =");
    js = js.replace(/(\w+): number =/g, "$1 =");
    js = js.replace(/(\w+): boolean =/g, "$1 =");
  } else {
    js = js.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "");
    js = js.replace(/^import \{ createHash \} from "crypto";\n+/, "");
    js = headerSecurity + `import { createHash } from "crypto";\n\n` + js;
    js = js.replace(/: void/g, "");
    js = js.replace(/: string\[\]/g, "");
    js = js.replace(/: string/g, "");
    js = js.replace(/: boolean/g, "");
    js = js.replace(/: number/g, "");
    js = js.replace(/\|\s*null\s*\|\s*undefined/g, "");
    js = js.replace(/\| null/g, "");
    js = js.replace(/\| undefined/g, "");
    js = js.replace(/ as const/g, "");
    js = js.replace(/: any/g, "");
    // Specific
    js = js.replace(/filePath: string/g, "filePath");
    js = js.replace(/content: string/g, "content");
    js = js.replace(/expectedHash: string/g, "expectedHash");
    js = js.replace(/label: string/g, "label");
    js = js.replace(/cmd: string/g, "cmd");
    js = js.replace(/patterns: string\[\] =/g, "patterns =");
    js = js.replace(/<string>/g, "");
    js = js.replace(/<any>/g, "");
  }
  return js;
}

export function syncControllerCore(projectRoot: string, checkOnly = false): boolean {
  let changed = false;

  // 1. src/controller-core.ts -> assets/plugins/controller-core.ts (TS verbatim)
  const srcController = join(projectRoot, "src", "controller-core.ts");
  const pluginController = join(projectRoot, "assets", "plugins", "ostacky-controller", "controller-core.ts");
  const mcpController = join(projectRoot, "assets", "mcp", "ostacky-controller", "controller-core.js");

  if (!existsSync(srcController)) throw new Error(`Falta canónico: ${srcController}`);
  const srcContent = readFileSync(srcController, "utf-8");

  // TS mirror: verbatim but ensure header mentions generado
  let pluginContent = srcContent;
  if (!pluginContent.includes("Generado desde src/controller-core.ts")) {
    pluginContent = pluginContent.replace(
      /^\/\*\*[\s\S]*?\*\//,
      `/**\n * controller-core — Single source of truth para TRANSITIONS, STATES, DEFAULT_STATE y helpers.\n * Generado desde src/controller-core.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */`
    );
  }
  // Ensure import stays "./security.ts" (plugin server runtime does not resolve .js -> .ts)

  if (!existsSync(pluginController) || readFileSync(pluginController, "utf-8") !== pluginContent) {
    if (checkOnly) throw new Error(`Desactualizado: ${pluginController} (corre bun run scripts/sync-controller-core.ts)`);
    writeFileSync(pluginController, pluginContent, "utf-8");
    changed = true;
  }

  // JS mirror: stripped
  const mcpContent = tsToJsMinimal(srcContent, true);
  if (!existsSync(mcpController) || readFileSync(mcpController, "utf-8") !== mcpContent) {
    if (checkOnly) throw new Error(`Desactualizado: ${mcpController}`);
    writeFileSync(mcpController, mcpContent, "utf-8");
    changed = true;
  }

  // 2. src/security.ts -> assets/plugins/security.ts (TS minimal) + assets/mcp/.../security.js (JS minimal)
  // Solo el bloque Sensitive guard es relevante para plugin/MCP. Crypto helpers (validateFilePath, sha256) solo para CLI.
  const srcSecurity = join(projectRoot, "src", "security.ts");
  const pluginSecurity = join(projectRoot, "assets", "plugins", "ostacky-controller", "security.ts");
  const mcpSecurity = join(projectRoot, "assets", "mcp", "ostacky-controller", "security.js");
  if (!existsSync(srcSecurity)) throw new Error(`Falta canónico: ${srcSecurity}`);
  const secContent = readFileSync(srcSecurity, "utf-8");
  // Extraer solo desde el marcador Sensitive guard para mirrors (plugin/MCP no necesitan crypto)
  const sensitiveMarker = "// ─── Sensitive guard";
  const sensitiveIdx = secContent.indexOf(sensitiveMarker);
  const sensitiveBlock = sensitiveIdx !== -1 ? secContent.slice(sensitiveIdx) : secContent;
  let pluginSecContent = `/**\n * security.ts — mirror de src/security.ts para plugin (self-contained, solo Sensitive guard)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n` + sensitiveBlock;
  if (!existsSync(pluginSecurity) || readFileSync(pluginSecurity, "utf-8") !== pluginSecContent) {
    if (checkOnly) throw new Error(`Desactualizado: ${pluginSecurity}`);
    writeFileSync(pluginSecurity, pluginSecContent, "utf-8");
    changed = true;
  }
  // MCP JS: mismo bloque sensitive pero strippado a JS (sin crypto, solo sensitive guard)
  let mcpBody = sensitiveBlock;
  // Quitar header existente del bloque para re-headers
  mcpBody = mcpBody.replace(/^\/\*\*[\s\S]*?\*\/\n+/, ""); // no header en sensitiveBlock, no-op
  // Strip TS types manualmente (sin añadir import crypto)
  mcpBody = mcpBody.replace(/: string\[\]/g, "");
  mcpBody = mcpBody.replace(/: string/g, "");
  mcpBody = mcpBody.replace(/: boolean/g, "");
  mcpBody = mcpBody.replace(/: number/g, "");
  mcpBody = mcpBody.replace(/: void/g, "");
  mcpBody = mcpBody.replace(/\|\s*null\s*\|\s*undefined/g, "");
  mcpBody = mcpBody.replace(/\| null/g, "");
  mcpBody = mcpBody.replace(/\| undefined/g, "");
  mcpBody = mcpBody.replace(/ as const/g, "");
  mcpBody = mcpBody.replace(/: any/g, "");
  mcpBody = mcpBody.replace(/patterns: string\[\] =/g, "patterns =");
  mcpBody = mcpBody.replace(/filePath: string/g, "filePath");
  mcpBody = mcpBody.replace(/cmd: string/g, "cmd");
  mcpBody = mcpBody.replace(/<string>/g, "");
  mcpBody = mcpBody.replace(/<any>/g, "");
  const finalMcpSec = `/**\n * security.js — source-of-truth mirror of src/security.ts for controller (Node)\n * Generado desde src/security.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n` + mcpBody;
  if (!existsSync(mcpSecurity) || readFileSync(mcpSecurity, "utf-8") !== finalMcpSec) {
    if (checkOnly) throw new Error(`Desactualizado: ${mcpSecurity}`);
    writeFileSync(mcpSecurity, finalMcpSec, "utf-8");
    changed = true;
  }

  // 3. src/tiered.ts -> assets/plugins/tiered.ts (TS)
  const srcTiered = join(projectRoot, "src", "tiered.ts");
  const pluginTiered = join(projectRoot, "assets", "plugins", "ostacky-controller", "tiered.ts");
  if (!existsSync(srcTiered)) throw new Error(`Falta canónico: ${srcTiered}`);
  const tieredContent = readFileSync(srcTiered, "utf-8");
  let pluginTieredContent = tieredContent;
  if (!pluginTieredContent.includes("Generado desde src/tiered.ts")) {
    pluginTieredContent = `/**\n * tiered.ts — mirror de src/tiered.ts para plugin (self-contained)\n * Generado desde src/tiered.ts — NO EDITAR. Ejecutá \`bun run scripts/sync-controller-core.ts\`.\n */\n\n` + pluginTieredContent;
  }
  if (!existsSync(pluginTiered) || readFileSync(pluginTiered, "utf-8") !== pluginTieredContent) {
    if (checkOnly) throw new Error(`Desactualizado: ${pluginTiered}`);
    writeFileSync(pluginTiered, pluginTieredContent, "utf-8");
    changed = true;
  }

  return changed;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isDirectRun) {
  const checkOnly = process.argv.includes("--check");
  try {
    const changed = syncControllerCore(projectRoot, checkOnly);
    console.log(checkOnly ? "Sync verificado (controller-core + security + tiered)" : changed ? "Sincronizado: mirrors actualizados desde src/" : "Mirrors ya sincronizados");
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
