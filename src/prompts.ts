import * as p from "@clack/prompts";
import { join } from "path";
import {
  fetchManifest,
  fetchLatestManifest,
  type Manifest,
  type ManifestItem,
} from "./github.js";
import {
  findOpenCodeDir,
  findProjectRoot,
  createOpenCodeDir,
  ensureOpenCodePaths,
  installAgent,
  installCommand,
  isAgentInstalled,
  isCommandInstalled,
  uninstallAgent,
  uninstallCommand,
  uninstallAll,
  type OpenCodePaths,
} from "./installer.js";
import { readLockfile, getInstalledVersion, clearLockfile } from "./lockfile.js";
import { validateFilePath } from "./security.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function onCancel(value: unknown): asserts value is NonNullable<unknown> {
  if (p.isCancel(value)) {
    p.outro("Operación cancelada.");
    process.exit(0);
  }
}

async function loadManifest(): Promise<Manifest> {
  const spin = p.spinner();
  spin.start("Obteniendo recursos disponibles...");
  const manifest = await fetchManifest();
  spin.stop(`Recursos cargados  (${manifest.tag})`);
  return manifest;
}

/**
 * Busca el manifest más reciente consultando GitHub Releases API.
 * Informa al usuario si hay una nueva versión disponible.
 */
async function loadLatestManifest(): Promise<Manifest> {
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

/**
 * Prints a panel with the next steps the user should follow after
 * installing agents/commands. Idempotent. Safe to call multiple times.
 */
export function printPostInstallSteps(): void {
  p.note(
    [
      "Recargá OpenCode",
      "Ejecutá /install-stack para instalar el stack",
      "Recargá OpenCode nuevamente",
      "Usá @Ostacky para invocar al agente",
    ].join("\n  → "),
    "Próximos pasos"
  );
}

/**
 * Finds an existing .opencode dir, or prompts the user to create one.
 * Returns null if the user declines.
 */
async function resolveOpenCodePaths(): Promise<OpenCodePaths | null> {
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

interface UpdateCandidate {
  type: "agents" | "commands";
  item: ManifestItem;
  installedVersion: string | null;
}

/**
 * Compara las versiones instaladas (lockfile) contra las del manifest remoto.
 * Retorna solo los items que tienen una versión diferente (o no instalados
 * pero que el usuario ya tiene el archivo — overwrite candidate).
 */
function getUpdateCandidates(
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

  return candidates;
}

function formatVersionDiff(from: string | null, to: string): string {
  return from ? `${from} → ${to}` : `(sin versión) → ${to}`;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function doInstallAll(manifest: Manifest, paths: OpenCodePaths) {
  const spin = p.spinner();
  let errors = 0;

  for (const agent of manifest.agents) {
    spin.start(`Descargando agente: ${agent.name}  (${agent.version})`);
    try {
      await installAgent(agent, manifest, paths);
      spin.stop(`Agente instalado: ${agent.name}  (${agent.version})`);
    } catch (e) {
      spin.stop(`Error en ${agent.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  for (const cmd of manifest.commands) {
    spin.start(`Descargando command: ${cmd.name}  (${cmd.version})`);
    try {
      await installCommand(cmd, manifest, paths);
      spin.stop(`Command instalado: ${cmd.name}  (${cmd.version})`);
    } catch (e) {
      spin.stop(`Error en ${cmd.name}: ${(e as Error).message}`);
      errors++;
    }
  }

  if (errors === 0) {
    p.log.success("Todo instalado correctamente.");
  } else {
    p.log.warn(`Completado con ${errors} error(es).`);
  }
}

async function doAddAgent(manifest: Manifest, paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);

  const options = manifest.agents.map((a) => {
    const installed = getInstalledVersion(lockfile, "agents", a.name);
    const hint = installed
      ? `v${installed} instalado — ${a.description}`
      : a.description;
    return { value: a.name, label: `${a.name}  (v${a.version})`, hint };
  });

  const selected = await p.multiselect({
    message: "¿Qué agentes deseas instalar?",
    options,
    required: true,
  });
  onCancel(selected);

  const spin = p.spinner();
  for (const name of selected as string[]) {
    const item = manifest.agents.find((a) => a.name === name)!;
    spin.start(`Descargando agente: ${name}  (${item.version})`);
    try {
      await installAgent(item, manifest, paths);
      spin.stop(`Agente instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${(e as Error).message}`);
    }
  }
}

async function doAddCommand(manifest: Manifest, paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);

  const options = manifest.commands.map((c) => {
    const installed = getInstalledVersion(lockfile, "commands", c.name);
    const hint = installed
      ? `v${installed} instalado — ${c.description}`
      : c.description;
    return { value: c.name, label: `${c.name}  (v${c.version})`, hint };
  });

  const selected = await p.multiselect({
    message: "¿Qué commands deseas instalar?",
    options,
    required: true,
  });
  onCancel(selected);

  const spin = p.spinner();
  for (const name of selected as string[]) {
    const item = manifest.commands.find((c) => c.name === name)!;
    spin.start(`Descargando command: ${name}  (${item.version})`);
    try {
      await installCommand(item, manifest, paths);
      spin.stop(`Command instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${(e as Error).message}`);
    }
  }
}

/**
 * Update inteligente:
 * 1. Obtiene el último manifest via GitHub Releases API.
 * 2. Compara versiones instaladas (lockfile) vs manifest remoto.
 * 3. Muestra diff de versiones y pide confirmación.
 * 4. Descarga solo los items que cambiaron.
 */
async function doUpdate(manifest: Manifest, paths: OpenCodePaths) {
  const candidates = getUpdateCandidates(manifest, paths);

  if (candidates.length === 0) {
    p.log.info("Todo está al día. No hay actualizaciones disponibles.");
    return;
  }

  // Muestra diff de versiones
  const diffLines = candidates.map(({ type, item, installedVersion }) => {
    const kind = type === "agents" ? "agente" : "command";
    return `  ${kind.padEnd(8)} ${item.name.padEnd(16)} ${formatVersionDiff(
      installedVersion,
      item.version
    )}`;
  });

  p.note(diffLines.join("\n"), "Actualizaciones disponibles");

  const confirm = await p.confirm({
    message: `¿Aplicar ${candidates.length} actualización(es)?`,
  });
  onCancel(confirm);

  if (!confirm) {
    p.log.info("Actualización cancelada.");
    return;
  }

  const spin = p.spinner();
  let updated = 0;

  for (const { type, item } of candidates) {
    spin.start(`Actualizando: ${item.name}  → ${item.version}`);
    try {
      if (type === "agents") {
        await installAgent(item, manifest, paths);
      } else {
        await installCommand(item, manifest, paths);
      }
      spin.stop(`Actualizado: ${item.name}  (${item.version})`);
      updated++;
    } catch (e) {
      spin.stop(`Error en ${item.name}: ${(e as Error).message}`);
    }
  }

  p.log.success(`${updated} recurso(s) actualizado(s).`);
}

// ─── Exported flows ───────────────────────────────────────────────────────────

export async function runInteractiveMenu() {
  p.intro(" OpenCode Installer ");

  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();

  if (!paths) {
    p.outro("Instalación cancelada.");
    return;
  }

  const action = await p.select({
    message: "¿Qué deseas hacer?",
    options: [
      { value: "all", label: "Instalar todo" },
      { value: "agent", label: "Instalar agente" },
      { value: "command", label: "Instalar command" },
      { value: "update", label: "Actualizar instalación" },
      { value: "uninstall", label: "Desinstalar" },
      { value: "exit", label: "Salir" },
    ],
  });
  onCancel(action);

  switch (action as string) {
    case "all":
      await doInstallAll(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "agent":
      await doAddAgent(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "command":
      await doAddCommand(manifest, paths);
      printPostInstallSteps();
      p.outro("Listo.");
      break;
    case "update": {
      // Para update siempre buscamos el manifest más reciente
      const latestManifest = await loadLatestManifest();
      await doUpdate(latestManifest, paths);
      p.outro("Listo.");
      break;
    }
    case "uninstall":
      await doUninstall(paths);
      p.outro("Listo.");
      break;
    case "exit":
      p.outro("Hasta luego.");
      break;
  }
}

export async function runInstallCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doInstallAll(manifest, paths);
  printPostInstallSteps();
  p.outro("Instalación completada.");
}

export async function runAddAgentCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddAgent(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runAddCommandCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doAddCommand(manifest, paths);
  printPostInstallSteps();
  p.outro("Listo.");
}

export async function runUpdateCommand() {
  p.intro(" OpenCode Installer ");
  const manifest = await loadLatestManifest();
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doUpdate(manifest, paths);
  p.outro("Actualización completada.");
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

async function doUninstallTotal(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (
    !lockfile ||
    (Object.keys(lockfile.agents).length === 0 &&
      Object.keys(lockfile.commands).length === 0)
  ) {
    p.log.info("No hay nada instalado.");
    return;
  }

  const pathsToDelete: string[] = [];
  for (const name of Object.keys(lockfile.agents)) {
    pathsToDelete.push(join(paths.agents, `${name}.md`));
  }
  for (const name of Object.keys(lockfile.commands)) {
    pathsToDelete.push(join(paths.commands, `${name}.md`));
  }

  p.note(
    pathsToDelete.join("\n"),
    `Se eliminarán ${pathsToDelete.length} archivo(s)`
  );

  const confirm = await p.confirm({
    message: `¿Confirmar desinstalación de ${pathsToDelete.length} archivo(s)?`,
  });
  onCancel(confirm);
  if (!confirm) {
    p.log.info("Desinstalación cancelada.");
    return;
  }

  uninstallAll(paths);
  p.log.success(`${pathsToDelete.length} archivo(s) eliminado(s).`);
}

async function doUninstallAgent(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.agents);
  if (installed.length === 0) {
    p.log.info("No hay agentes instalados.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.agents[name].version}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué agentes querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallAgent(name, paths);
    if (ok) {
      p.log.success(`Agente eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el agente: ${name}`);
    }
  }
}

async function doUninstallCommand(paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);
  if (!lockfile) {
    p.log.warn("No hay instalación registrada.");
    return;
  }
  const installed = Object.keys(lockfile.commands);
  if (installed.length === 0) {
    p.log.info("No hay commands instalados.");
    return;
  }

  const options = installed.map((name) => ({
    value: name,
    label: name,
    hint: `v${lockfile.commands[name].version}`,
  }));

  const selected = await p.multiselect({
    message: "¿Qué commands querés desinstalar?",
    options,
    required: true,
  });
  onCancel(selected);

  for (const name of selected as string[]) {
    const ok = uninstallCommand(name, paths);
    if (ok) {
      p.log.success(`Command eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el command: ${name}`);
    }
  }
}

async function doUninstall(paths: OpenCodePaths) {
  const scope = await p.select({
    message: "¿Qué querés desinstalar?",
    options: [
      { value: "all", label: "Todo (agentes + commands)" },
      { value: "agent", label: "Solo un agente" },
      { value: "command", label: "Solo un command" },
    ],
  });
  onCancel(scope);

  switch (scope as string) {
    case "all":
      await doUninstallTotal(paths);
      break;
    case "agent":
      await doUninstallAgent(paths);
      break;
    case "command":
      await doUninstallCommand(paths);
      break;
  }
}

export async function runUninstallCommand() {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }
  await doUninstallTotal(paths);
  p.outro("Desinstalación completada.");
}

export async function runUninstallAgentCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }

  if (name) {
    try {
      validateFilePath(`${name}.md`);
    } catch (e) {
      p.log.warn(`Nombre inválido: ${(e as Error).message}`);
      return;
    }
    const lockfile = readLockfile(paths.root);
    if (!lockfile || !(name in lockfile.agents)) {
      p.log.warn(`${name} no está instalado.`);
      return;
    }
    const filePath = join(paths.agents, `${name}.md`);
    p.note(filePath, `Se eliminará`);
    const confirm = await p.confirm({ message: `¿Borrar ${name}.md?` });
    onCancel(confirm);
    if (!confirm) {
      p.log.info("Cancelado.");
      return;
    }
    const ok = uninstallAgent(name, paths);
    if (ok) {
      p.log.success(`Agente eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el agente: ${name}`);
    }
  } else {
    await doUninstallAgent(paths);
  }
  p.outro("Listo.");
}

export async function runUninstallCommandCommand(name?: string) {
  p.intro(" OpenCode Installer ");
  const paths = await resolveOpenCodePaths();
  if (!paths) { p.outro("Cancelado."); return; }

  if (name) {
    try {
      validateFilePath(`${name}.md`);
    } catch (e) {
      p.log.warn(`Nombre inválido: ${(e as Error).message}`);
      return;
    }
    const lockfile = readLockfile(paths.root);
    if (!lockfile || !(name in lockfile.commands)) {
      p.log.warn(`${name} no está instalado.`);
      return;
    }
    const filePath = join(paths.commands, `${name}.md`);
    p.note(filePath, `Se eliminará`);
    const confirm = await p.confirm({ message: `¿Borrar ${name}.md?` });
    onCancel(confirm);
    if (!confirm) {
      p.log.info("Cancelado.");
      return;
    }
    const ok = uninstallCommand(name, paths);
    if (ok) {
      p.log.success(`Command eliminado: ${name}`);
    } else {
      p.log.warn(`No se pudo eliminar el command: ${name}`);
    }
  } else {
    await doUninstallCommand(paths);
  }
  p.outro("Listo.");
}
