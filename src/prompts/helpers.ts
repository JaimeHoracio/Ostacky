import * as p from "@clack/prompts";
import { join } from "path";
import { existsSync } from "fs";
import {
  fetchManifest,
  fetchLatestManifest,
  type Manifest,
  type ManifestItem,
} from "../github.js";
import {
  findOpenCodeDir,
  findProjectRoot,
  createOpenCodeDir,
  ensureOpenCodePaths,
  ensureToolDirs,
  getGlobalOpenCodeDir,
  getOpenCodeDirForScope,
  type Scope,
} from "../fs.js";
import { homedir } from "os";
import {
  readLockfile,
  getInstalledVersion,
} from "../lockfile.js";
import {
  isAgentInstalled,
  isCommandInstalled,
  isSkillInstalled,
  isMcpServerInstalled,
  type OpenCodePaths,
} from "../installer.js";

export function onCancel(value: unknown): asserts value is NonNullable<unknown> {
  if (p.isCancel(value)) {
    p.outro("Operación cancelada.");
    process.exit(0);
  }
}

export async function loadManifest(): Promise<Manifest> {
  const spin = p.spinner();
  spin.start("Obteniendo recursos disponibles...");
  const manifest = await fetchManifest();
  spin.stop(`Recursos cargados  (${manifest.tag})`);
  return manifest;
}

export async function loadLatestManifest(): Promise<Manifest> {
  const spin = p.spinner();
  spin.start("Buscando actualizaciones en GitHub...");
  const { manifest, isNew, latestTag } = await fetchLatestManifest();
  if (isNew && latestTag) {
    spin.stop(`Nueva versión detectada: ${latestTag}`);
  } else {
    spin.stop(`Manifest actualizado  (${manifest.tag})`);
  }
  return manifest;
}

export function printPostInstallSteps(): void {
  p.note(
    [
      "Cerrá y reiniciá OpenCode si ya estaba corriendo (los MCP no recargan su config en caliente):",
      "  TUI → opencode",
      "  Web → opencode web --port 4096",
      "Escribí @Ostacky en el chat (TUI o web) para invocar al agente",
      "Skills bundleadas en .opencode/skills/ — revisá cuáles activás",
      "¿Errores en el stack? Ejecutá /install-stack desde el chat de OpenCode",
    ].join("\n"),
    "Próximos pasos"
  );
}

export async function resolveOpenCodePaths(scope?: Scope | null): Promise<OpenCodePaths | null> {
  // Si se pasó scope explícito, resolver sin preguntar (salvo auto que decide solo)
  if (scope === "local" || scope === "global" || scope === "auto") {
    const dir = getOpenCodeDirForScope(scope);
    const isGlobalDir = dir.replace(/\\/g, "/") === getGlobalOpenCodeDir().replace(/\\/g, "/");
    try {
      const paths = ensureOpenCodePaths(dir);
      if (scope === "global") p.note(dir, "Instalación global");
      else if (scope === "auto") p.note(dir, `Scope auto → ${isGlobalDir ? "global" : "local"}`);
      else p.note(dir, "Instalación local");
      return paths;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if ((scope === "global" || (scope === "auto" && isGlobalDir)) && (msg.includes("EACCES") || msg.toLowerCase().includes("permission"))) {
        p.log.warn(`No se pudo escribir en global (${dir}): ${msg}. ¿Instalar local?`);
        const retry = await p.confirm({ message: "¿Reintentar como instalación local?" });
        onCancel(retry);
        if (retry) {
          const localDir = getOpenCodeDirForScope("local");
          return ensureOpenCodePaths(localDir);
        }
      }
      throw e;
    }
  }

  // Sin scope explícito → preguntar al usuario, por defecto local (como pidió el usuario)
  // Prioridad local a menos que el usuario elija global
  const cwd = process.cwd();
  const localDir = getOpenCodeDirForScope("local", cwd);
  const globalDir = getGlobalOpenCodeDir();
  const hasLocal = !!findOpenCodeDir(cwd);
  const scopeChoice = await p.select({
    message: `¿Instalar en proyecto local (${localDir}) o global (${globalDir})?`,
    options: [
      { value: "local" as Scope, label: "Local", hint: `${localDir} (recomendado)` },
      { value: "global" as Scope, label: "Global", hint: globalDir },
    ],
    initialValue: "local" as Scope,
  });
  onCancel(scopeChoice);
  const chosen = scopeChoice as Scope;
  const dir = getOpenCodeDirForScope(chosen, cwd);
  try {
    return ensureOpenCodePaths(dir);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (chosen === "global" && (msg.includes("EACCES") || msg.includes("permission"))) {
      p.log.warn(`No se pudo escribir en global (${dir}): ${msg}.`);
      const retry = await p.confirm({ message: "¿Instalar local en su lugar?" });
      onCancel(retry);
      if (retry) return ensureOpenCodePaths(getOpenCodeDirForScope("local", cwd));
    }
    throw e;
  }
}

/**
 * Helper para comandos que ya tienen paths resueltos y solo necesitan validar scope global para install-stack
 * Normaliza separadores para soportar Windows (backslashes) y Unix (slashes).
 */
export function isGlobalScope(paths: OpenCodePaths): boolean {
  const globalDir = getGlobalOpenCodeDir().replace(/\\/g, "/");
  const root = paths.root.replace(/\\/g, "/");
  return root === globalDir || root.startsWith(globalDir + "/");
}

// ─── Version diff helpers ─────────────────────────────────────────────────────

export interface UpdateCandidate {
  type: "agents" | "commands" | "skills" | "mcpServers";
  item: ManifestItem;
  installedVersion: string | null;
}

export interface OrphanItem {
  type: "agents" | "commands" | "skills" | "mcpServers";
  name: string;
  version: string;
}

export function getOrphanedItems(
  manifest: Manifest,
  paths: OpenCodePaths
): OrphanItem[] {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) return [];

  const manifestNames = {
    agents: new Set(manifest.agents.map((a) => a.name)),
    commands: new Set(manifest.commands.map((c) => c.name)),
    skills: new Set((manifest.skills ?? []).map((s) => s.name)),
    mcpServers: new Set((manifest.mcpServers ?? []).map((m) => m.name)),
  };

  const orphans: OrphanItem[] = [];
  for (const type of ["agents", "commands", "skills", "mcpServers"] as const) {
    for (const [name, data] of Object.entries(lockfile[type] ?? {})) {
      if (!manifestNames[type].has(name)) {
        orphans.push({ type, name, version: data.version });
      }
    }
  }
  return orphans;
}

export function getUpdateCandidates(
  manifest: Manifest,
  paths: OpenCodePaths
): UpdateCandidate[] {
  const lockfile = readLockfile(paths.root);
  const candidates: UpdateCandidate[] = [];

  for (const item of manifest.agents) {
    if (!isAgentInstalled(item.name, paths)) continue;
    const installed = getInstalledVersion(lockfile, "agents", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "agents", item, installedVersion: installed });
    }
  }

  for (const item of manifest.commands) {
    if (!isCommandInstalled(item.name, paths)) continue;
    const installed = getInstalledVersion(lockfile, "commands", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "commands", item, installedVersion: installed });
    }
  }

  for (const item of manifest.skills ?? []) {
    if (!isSkillInstalled(item.name, paths)) continue;
    const installed = getInstalledVersion(lockfile, "skills", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "skills", item, installedVersion: installed });
    }
  }

  for (const item of manifest.mcpServers ?? []) {
    if (!isMcpServerInstalled(item.name, paths)) continue;
    const installed = getInstalledVersion(lockfile, "mcpServers", item.name);
    if (installed !== item.version) {
      candidates.push({ type: "mcpServers", item, installedVersion: installed });
    }
  }

  return candidates;
}

export function formatVersionDiff(from: string | null, to: string): string {
  return from ? `${from} → ${to}` : `(sin versión) → ${to}`;
}

export function kindLabel(type: UpdateCandidate["type"]): string {
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
