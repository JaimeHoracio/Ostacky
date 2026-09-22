import { existsSync, readFileSync } from "fs";
import { join, delimiter, isAbsolute } from "path";
import { findOpenCodeConfig, readOpenCodeConfig } from "./config.js";
import { findOpenCodeDir } from "./fs.js";

/**
 * Checks V2 de `doctor`: validez API V2 del plugin, forma `mcp.servers`,
 * legacy ajeno (warn-only) y existencia de `command` locales.
 *
 * Read-only: nunca escribe. Retorna líneas ya prefijadas (✅/⚠️/❌/ℹ️).
 */
export function checkDoctorV2(projectRoot: string): string[] {
  const lines: string[] = [];
  const cwd = projectRoot;
  const opencodeDir = findOpenCodeDir(cwd) || join(cwd, ".opencode");

  // 1) Plugin: existe no basta — debe ser API V2
  const pluginPaths = [
    join(opencodeDir, "plugins", "ostacky-plugin.ts"),
    join(cwd, ".opencode", "plugins", "ostacky-plugin.ts"),
    join(cwd, "assets", "plugins", "ostacky-plugin.ts"),
  ];
  const found = pluginPaths.find((p) => existsSync(p));
  if (found) {
    try {
      const src = readFileSync(found, "utf-8");
      const isV2 = src.includes("Plugin.define") && src.includes("@opencode/plugin") && !src.includes("@opencode-ai/plugin");
      if (isV2) lines.push(`✅ controller: plugin V2 (${found})`);
      else lines.push(`⚠️ controller: plugin legacy V1 en ${found} — no corre en V2, reinstalá con ostacky`);
    } catch {
      lines.push(`⚠️ controller: no se pudo leer ${found}`);
    }
  }

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

  // 4) Commands locales existen (detecta proyecto movido)
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object") continue;
    const cmd = (entry as Record<string, unknown>).command;
    if ((entry as Record<string, unknown>).type === "local" && Array.isArray(cmd) && typeof cmd[0] === "string") {
      const bin = cmd[0] as string;
      const ok = isAbsolute(bin) ? existsSync(bin) : lookupOnPath(bin) !== null;
      if (!ok) lines.push(`⚠️ mcp.servers.${name} command no existe (${bin}) — ¿proyecto movido? re-corré install`);
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
