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
} from "../fs.js";
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

export async function resolveOpenCodePaths(): Promise<OpenCodePaths | null> {
  const existing = findOpenCodeDir();

  if (existing) {
    const paths = ensureOpenCodePaths(existing);
    p.note(existing, "Directorio .opencode encontrado");
    return paths;
  }

  const projectRoot = findProjectRoot();
  p.note(
    `No se encontró .opencode\nRaíz detectada: ${projectRoot}`,
    "Aviso"
  );

  const create = await p.confirm({
    message: "¿Deseas crear la estructura .opencode aquí?",
  });
  onCancel(create);

  if (!create) return null;

  const paths = createOpenCodeDir(projectRoot);
  p.log.success(`Estructura creada en ${paths.root}`);
  return paths;
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
