import { existsSync, readFileSync, readdirSync } from "fs";
import { join, delimiter, isAbsolute } from "path";
import { findOpenCodeConfig, readOpenCodeConfig } from "./config.js";
import { findOpenCodeDir, getGlobalOpenCodeDir } from "./fs.js";

/**
 * Artefactos de Ostacky en el config dir GLOBAL. OpenCode V2 dedupea plugins
 * por `id` y conserva la PRIMERA ocurrencia en orden de arranque (el config
 * global se descubre antes que el del proyecto): con el mismo id la copia
 * global gana y la local queda `failed: "Duplicate plugin ID"`, o sea los gates
 * dejan de aplicarse sin avisar. La copia global nueva declara
 * `ostacky-controller-global` y se retira sola si hay instalación local; solo
 * las copias legacy (id compartido) colisionan. Solo detecta: nunca borra.
 */
export function globalOstackyArtifacts(globalDir: string = getGlobalOpenCodeDir()): string[] {
  const found: string[] = [];
  const candidates = [
    join(globalDir, "agent", "ostacky.md"),
    join(globalDir, "plugins", "ostacky-controller", "index.ts"),
    join(globalDir, "plugin", "ostacky-controller", "index.ts"),
    join(globalDir, "command", "ostacky.md"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) found.push(p);
    } catch {}
  }
  for (const cfgName of ["opencode.json", "opencode.jsonc"]) {
    const cfg = join(globalDir, cfgName);
    try {
      if (!existsSync(cfg)) continue;
      const raw = readFileSync(cfg, "utf-8");
      const json = JSON.parse(raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
      const servers = (json as any)?.mcp?.servers ?? (json as any)?.mcp ?? {};
      if (servers && servers["ostacky-controller"]) found.push(cfg);
    } catch {}
  }
  return found;
}

/**
 * ¿La copia global del plugin conoce el scope? `true` = declara el id
 * `ostacky-controller-global` (convive con la local y le cede precedencia).
 * `false` = copia legacy con id compartido (colisiona: gana el global).
 * `null` = no hay plugin Ostacky en el scope global.
 */
export function globalPluginScopeAware(globalDir: string = getGlobalOpenCodeDir()): boolean | null {
  const candidates = [
    join(globalDir, "plugins", "ostacky-controller", "index.ts"),
    join(globalDir, "plugin", "ostacky-controller", "index.ts"),
    join(globalDir, "plugins", "ostacky-controller", "index.js"),
    join(globalDir, "plugin", "ostacky-controller", "index.js"),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      return readFileSync(p, "utf-8").includes("ostacky-controller-global");
    } catch {}
  }
  return null;
}

/**
 * Checks V2 de `doctor`: validez API V2 del plugin, forma `mcp.servers`,
 * legacy ajeno (warn-only) y existencia de `command` locales.
 *
 * Read-only: nunca escribe. Retorna líneas ya prefijadas (✅/⚠️/❌/ℹ️).
 */
export function checkDoctorV2(projectRoot: string): string[] {
  const lines: string[] = [];
  // Convivencia global/local: solo avisa, nunca borra. Va antes de los checks
  // con early-return para que el aviso no dependa del estado del proyecto.
  const globalArtifacts = globalOstackyArtifacts();
  if (globalArtifacts.length > 0) {
    if (globalPluginScopeAware() === false) {
      lines.push(
        `⚠️ plugin global legacy (id compartido): OpenCode V2 conserva la copia global y deshabilita la local ("Duplicate plugin ID: ostacky-controller") — los gates los aplica el plugin global, no el local. Actualizá el global (npx ostacky install --scope global) o limpiá con: npx ostacky uninstall --scope global`
      );
    } else {
      lines.push(
        `⚠️ Instalación global convive con la local: ${globalArtifacts.join(", ")}. El plugin global cede la precedencia al local (ids distintos, sin colisión); el resto de los artefactos globales queda como residuo si no los usás. Limpiá con: npx ostacky uninstall --scope global`
      );
    }
  }

  const cwd = projectRoot;
  const opencodeDir = findOpenCodeDir(cwd) || join(cwd, ".opencode");

  // 1) Plugin: existe no basta — debe ser API V2.
  // Layout V2: package dir (un ID = un directorio); sueltos legacy se aceptan
  // pero los helpers sin default siempre fallan en el server (ver 1b).
  const pluginPaths = [
    join(opencodeDir, "plugins", "ostacky-controller", "index.ts"),
    join(cwd, ".opencode", "plugins", "ostacky-controller", "index.ts"),
    join(opencodeDir, "plugins", "ostacky-plugin.ts"),
    join(cwd, ".opencode", "plugins", "ostacky-plugin.ts"),
    join(cwd, "assets", "plugins", "ostacky-plugin.ts"),
  ];
  const found = pluginPaths.find((p) => existsSync(p));
  if (found) {
    try {
      const src = readFileSync(found, "utf-8");
      // Check estructural (no por menciones en comentarios): V2 = `export default`
      // sin paquete legacy `@opencode-ai/*` en runtime. El plugin Ostacky usa
      // objeto literal + `import type` a propósito (el server V2 no resuelve
      // `@opencode/plugin` en runtime desde `.opencode/plugins/`).
      const hasDefault = /export\s+default/.test(src);
      const hasLegacyPkg = src.includes("@opencode-ai/");
      if (hasDefault && !hasLegacyPkg) lines.push(`✅ controller: plugin V2 (${found})`);
      else lines.push(`⚠️ controller: plugin legacy V1 en ${found} — no corre en V2, reinstalá con ostacky`);
    } catch {
      lines.push(`⚠️ controller: no se pudo leer ${found}`);
    }
  }

  // 1b) Helpers sueltos sin default: el server los carga como plugins y fallan
  const pluginsDir = join(opencodeDir, "plugins");
  for (const f of ["controller-core.ts", "security.ts", "tiered.ts"]) {
    try {
      const p = join(pluginsDir, f);
      if (existsSync(p) && !readFileSync(p, "utf-8").includes("export default")) {
        lines.push(`⚠️ plugins/${f} suelto sin default — el server lo carga como plugin y falla; mové a plugins/ostacky-controller/ o re-corré install (doctor no lo modifica)`);
      }
    } catch {}
  }

  // 1c) Plugins globales V1: warn-only, jamás modificar (son del usuario)
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const globalPlugins = home ? join(home, ".config", "opencode", "plugins") : "";
    if (globalPlugins) {
      let entries: string[] = [];
      try {
        entries = readdirSync(globalPlugins).filter((e) => e.endsWith(".ts"));
      } catch {}
      for (const e of entries) {
        try {
          const src = readFileSync(join(globalPlugins, e), "utf-8");
          if (src.includes("@opencode-ai/") || !src.includes("export default")) {
            lines.push(`⚠️ global ${e} con formato V1 (@opencode-ai/* o sin default) — no corre en server V2; actualizalo o borralo a mano (doctor no lo modifica)`);
          }
        } catch {}
      }
    }
  } catch {}

  // 2) Config MCP: forma servers + legacy propio
  const configPath = findOpenCodeConfig(cwd);
  if (!configPath) {
    lines.push("ℹ️ config: no hay opencode.json ni opencode.jsonc");
    return lines;
  }
  let config: Record<string, unknown> | null = null;
  try {
    config = readOpenCodeConfig(configPath);
  } catch {
    lines.push(`⚠️ config: no se pudo parsear ${configPath}`);
    return lines;
  }
  if (!config) {
    lines.push(`⚠️ config: no se pudo parsear ${configPath}`);
    return lines;
  }

  const mcp = (config.mcp ?? {}) as Record<string, unknown>;
  const servers = (mcp.servers ?? {}) as Record<string, unknown>;
  const serverNames = Object.keys(servers);
  if (serverNames.length > 0) lines.push(`✅ mcp.servers: OK (${serverNames.length}: ${serverNames.join(", ")})`);

  for (const [key, value] of Object.entries(mcp)) {
    if (key === "servers" || key === "timeout") continue;
    if (value && typeof value === "object" && ("command" in (value as object) || "enabled" in (value as object) || "url" in (value as object))) {
      lines.push(`⚠️ mcp.${key} legacy (forma V1) — mové a mcp.servers.${key} con disabled (install lo migra con restore ante fallo)`);
    }
  }

  // 3) Legacy ajeno: warn-only, jamás modificar
  const renames: Record<string, string> = {
    permission: "permissions[]",
    agent: "agents",
    command: "commands",
    reference: "references",
    provider: "providers",
    snapshot: "snapshots",
    attachment: "media",
  };
  for (const [oldKey, newKey] of Object.entries(renames)) {
    if (oldKey in config) {
      lines.push(`⚠️ ${oldKey} legacy ajeno — V2 usa ${newKey}; se normaliza en memoria, migrá cuando quieras (doctor no lo modifica)`);
    }
  }

  // 4) Entradas mcp.servers con forma V2 (type/command-url/disabled/timeout) + binarios locales
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "local" && e.type !== "remote") {
      lines.push(`⚠️ mcp.servers.${name} sin type local|remote — V2 lo requiere (ver mcp-servers)`);
      continue;
    }
    if ("enabled" in e) {
      lines.push(`⚠️ mcp.servers.${name} usa enabled (forma V1) — V2 usa disabled invertido`);
    }
    if (typeof e.timeout === "number") {
      lines.push(`⚠️ mcp.servers.${name} timeout numérico (forma V1) — V2 usa timeout: { catalog, execution }`);
    }
    if (e.type === "local") {
      const cmd = e.command;
      if (!Array.isArray(cmd) || typeof cmd[0] !== "string") {
        lines.push(`⚠️ mcp.servers.${name} local sin command array — V2 requiere command: [bin, ...args]`);
      } else {
        const bin = cmd[0] as string;
        const ok = isAbsolute(bin) ? existsSync(bin) : lookupOnPath(bin) !== null;
        if (!ok) lines.push(`⚠️ mcp.servers.${name} command no existe (${bin}) — ¿proyecto movido? re-corré install`);
      }
    } else {
      if (typeof e.url !== "string" || !/^https?:\/\//.test(e.url)) {
        lines.push(`⚠️ mcp.servers.${name} remote sin url absoluta — V2 requiere url https://...`);
      }
      const oauth = (e as Record<string, unknown>).oauth;
      if (oauth && typeof oauth === "object") {
        for (const k of ["clientId", "clientSecret", "callbackPort", "redirectUri"]) {
          if (k in (oauth as object)) {
            lines.push(`⚠️ mcp.servers.${name} oauth.${k} camelCase (forma V1) — V2 usa snake_case`);
            break;
          }
        }
      }
    }
  }

  return lines;
}

function lookupOnPath(name: string): string | null {
  try {
    const pathEnv = process.env.PATH ?? "";
    const suffix = process.platform === "win32" ? ".exe" : "";
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue;
      try {
        if (existsSync(join(dir, name + suffix))) return join(dir, name + suffix);
        if (suffix && existsSync(join(dir, name))) return join(dir, name);
      } catch {}
    }
  } catch {}
  return null;
}
