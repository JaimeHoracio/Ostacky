import * as p from "@clack/prompts";
import { resolve } from "path";
import {
  fetchManifest,
  fetchLatestManifest,
  type Manifest,
  type ManifestItem,
} from "../github.js";
import {
  findProjectRoot,
  ensureOpenCodePaths,
  getOpenCodeDirForScope,
  isGitRepo,
  initGitRepo,
  type Scope,
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

export interface GitPreflightResult {
  projectRoot: string;
  gitReady: boolean;
}

export interface GitPreflightOptions {
  /** Pregunta inyectable (tests); por defecto `p.confirm`. Solo se llama en modo interactivo. */
  confirm?: () => Promise<unknown>;
  /** Por defecto `process.stdin.isTTY`. En no-interactivo nunca pregunta ni crea repos. */
  interactive?: boolean;
}

/**
 * Preflight Git compartido por las entradas de instalación ("Instalar todo",
 * `install-stack`). Si hay repo, root=toplevel. Si no hay, ofrece `git init`
 * (solo con confirmación explícita interactiva); al rechazar, sin git o en
 * modo no-interactivo, advierte que el aislamiento por worktree no está
 * disponible y sigue con cwd como root. Nunca crea un repo en silencio.
 */
export async function runGitPreflight(
  cwd: string = process.cwd(),
  opts?: GitPreflightOptions
): Promise<GitPreflightResult> {
  if (isGitRepo(cwd)) return { projectRoot: findProjectRoot(cwd), gitReady: true };
  const interactive = opts?.interactive ?? process.stdin.isTTY === true;
  if (interactive) {
    const ask = opts?.confirm ?? (() => p.confirm({ message: `No hay repo Git en ${cwd}. ¿Inicializar uno? (recomendado para aislamiento por worktree)` }));
    let answer: unknown = false;
    try {
      answer = await ask();
    } catch {
      answer = false;
    }
    if (answer === true) {
      try {
        initGitRepo(cwd);
        return { projectRoot: findProjectRoot(cwd), gitReady: true };
      } catch {
        // git roto o ausente → degradar con warning abajo
      }
    }
  }
  p.log.warn("Sin repo Git: aislamiento por worktree no disponible; se instala en el directorio actual.");
  return { projectRoot: resolve(cwd), gitReady: false };
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
      "  Web → opencode pair (abrí el link/QR en el navegador)",
      "Seleccioná el agente: `/agents` → `ostacky` (o Shift+Tab / Ctrl+X A)",
      "Skills bundleadas en .opencode/skills/ — revisá cuáles activás",
      "¿Errores en el stack? Ejecutá /install-stack desde el chat de OpenCode",
    ].join("\n"),
    "Próximos pasos"
  );
}

export async function resolveOpenCodePaths(scope?: Scope | null, opts?: { gitPreflight?: boolean }): Promise<OpenCodePaths | null> {
  // Global: dir global de OpenCode, sin git ni proyecto. Local (default): preflight + root.
  const effective = scope ?? "local";
  if (effective === "global") {
    const { getGlobalOpenCodeDir } = await import("../fs.js");
    const dir = getGlobalOpenCodeDir();
    try {
      const paths = ensureOpenCodePaths(dir);
      p.note(dir, "Instalación global");
      return paths;
    } catch (e) {
      throw e;
    }
  }
  const cwd = process.cwd();
  // Preflight solo en entradas de instalación ("Instalar todo", install-stack):
  // ofrece git init y fija el root antes de crear .opencode. El resto
  // (add/update/uninstall) resuelve el root sin preguntar ni crear nada.
  const base = opts?.gitPreflight ? (await runGitPreflight(cwd)).projectRoot : cwd;
  const dir = getOpenCodeDirForScope("local", base);
  if (scope && (scope as string) !== "local" && (scope as string) !== "global") {
    p.log.warn(`Scope ${(scope as string)} no soportado; usando local en ${dir}`);
  }
  try {
    const paths = ensureOpenCodePaths(dir);
    p.note(dir, "Instalación local");
    return paths;
  } catch (e) {
    throw e;
  }
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
