import * as p from "@clack/prompts";
import type { Manifest } from "../github.js";
import {
  installAgent,
  installCommand,
  installSkill,
  installMcpServer,
  type OpenCodePaths,
} from "../installer.js";
import { readLockfile, getInstalledVersion } from "../lockfile.js";
import { onCancel } from "./helpers.js";

export async function doAddAgent(manifest: Manifest, paths: OpenCodePaths) {
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

export async function doAddCommand(manifest: Manifest, paths: OpenCodePaths) {
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

export async function doAddSkill(manifest: Manifest, paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);

  const options = (manifest.skills ?? []).map((s) => {
    const installed = getInstalledVersion(lockfile, "skills", s.name);
    const hint = installed
      ? `v${installed} instalado — ${s.description}`
      : s.description;
    return { value: s.name, label: `${s.name}  (v${s.version})`, hint };
  });

  if (options.length === 0) {
    p.log.info("No hay skills disponibles en el manifest.");
    return;
  }

  const selected = await p.multiselect({
    message: "¿Qué skills deseas instalar?",
    options,
    required: true,
  });
  onCancel(selected);

  const spin = p.spinner();
  for (const name of selected as string[]) {
    const item = manifest.skills.find((s) => s.name === name)!;
    spin.start(`Instalando skill: ${name}  (${item.version})`);
    try {
      await installSkill(item, manifest, paths);
      spin.stop(`Skill instalada: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${(e as Error).message}`);
    }
  }
}

export async function doAddMcp(manifest: Manifest, paths: OpenCodePaths) {
  const lockfile = readLockfile(paths.root);

  const options = (manifest.mcpServers ?? []).map((m) => {
    const installed = getInstalledVersion(lockfile, "mcpServers", m.name);
    const hint = installed
      ? `v${installed} instalado — ${m.description}`
      : m.description;
    return { value: m.name, label: `${m.name}  (v${m.version})`, hint };
  });

  if (options.length === 0) {
    p.log.info("No hay MCP servers disponibles en el manifest.");
    return;
  }

  const selected = await p.multiselect({
    message: "¿Qué MCP servers deseas instalar?",
    options,
    required: true,
  });
  onCancel(selected);

  const spin = p.spinner();
  for (const name of selected as string[]) {
    const item = manifest.mcpServers?.find((m) => m.name === name);
    if (!item) continue;
    spin.start(`Instalando MCP server: ${name}  (${item.version})`);
    try {
      await installMcpServer(item, manifest, paths);
      spin.stop(`MCP server instalado: ${name}  (${item.version})`);
    } catch (e) {
      spin.stop(`Error: ${(e as Error).message}`);
    }
  }
}
