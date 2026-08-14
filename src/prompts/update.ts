import * as p from "@clack/prompts";
import type { Manifest } from "../github.js";
import {
  installAgent,
  installCommand,
  installSkill,
  installMcpServer,
  pruneStaleSkills,
  type OpenCodePaths,
} from "../installer.js";
import { removeFromLockfile } from "../lockfile.js";
import { onCancel, getUpdateCandidates, getOrphanedItems, kindLabel, formatVersionDiff } from "./helpers.js";

export async function doUpdate(manifest: Manifest, paths: OpenCodePaths) {
  const candidates = getUpdateCandidates(manifest, paths);
  const orphans = getOrphanedItems(manifest, paths);

  if (orphans.length > 0) {
    const orphanLines = orphans.map((o) => {
      const kind = kindLabel(o.type);
      return `  ${kind.padEnd(8)} ${o.name.padEnd(24)} v${o.version} (ya no existe en el manifest)`;
    });
    p.log.warn(`Items huérfanos detectados (ya no en manifest):`);
    p.note(orphanLines.join("\n"), "Items huérfanos");

    const shouldClean = await p.confirm({
      message: `¿Eliminar ${orphans.length} item(s) huérfano(s) del lockfile? No se borran archivos, solo el registro.`,
    });
    onCancel(shouldClean);

    if (shouldClean) {
      for (const o of orphans) {
        removeFromLockfile(paths.root, o.type, o.name);
      }
      p.log.success(`${orphans.length} item(s) huérfano(s) limpiados del lockfile.`);
    }
  }

  if (candidates.length === 0) {
    if (orphans.length > 0) {
      p.log.info("Lockfile limpiado. No hay actualizaciones disponibles.");
    } else {
      p.log.info("Todo está al día. No hay actualizaciones disponibles.");
    }
    return;
  }

  const diffLines = candidates.map(({ type, item, installedVersion }) => {
    const kind = kindLabel(type);
    return `  ${kind.padEnd(8)} ${item.name.padEnd(24)} ${formatVersionDiff(
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
      spin.stop(`Error en ${item.name}: ${(e as Error).message}`);
    }
  }

  p.log.success(`${updated} recurso(s) actualizado(s).`);

  // B3: prune skills obsoletas del filesystem (lockfile ya fue limpiado arriba)
  const pruned = pruneStaleSkills(paths, manifest);
  if (pruned.length > 0) {
    p.log.info(`Skills obsoletas removidas del filesystem: ${pruned.join(", ")}`);
  }
}
