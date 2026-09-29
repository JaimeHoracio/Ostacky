import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTreeHash } from "../src/fs.js";
import { sha256 } from "../src/security.js";
import { syncVersion } from "./sync-version.ts";

interface ManifestItem {
  file: string;
  sha256: string | null;
}

interface Manifest {
  agents?: ManifestItem[];
  commands?: ManifestItem[];
  skills?: ManifestItem[];
  mcpServers?: ManifestItem[];
}

function calculateHash(projectRoot: string, item: ManifestItem, category?: string): string {
  const assetPath = resolve(projectRoot, item.file);
  const projectRelative = relative(projectRoot, assetPath);
  if (projectRelative.startsWith("..") || projectRelative === "") {
    throw new Error(`Ruta de asset inválida: ${item.file}`);
  }
  if (!existsSync(assetPath)) throw new Error(`Asset no encontrado: ${item.file}`);

  // Skills: siempre tree hash del directorio que contiene SKILL.md
  // (installer usa computeTreeHash(getBundledSkillPath(name)) -> assets/skills/<name>/)
  if (category === "skills" || item.file.includes("/skills/") || item.file.includes("\\skills\\")) {
    const skillDir = item.file.endsWith("SKILL.md") ? dirname(assetPath) : assetPath;
    // Si el path ya es directorio (con o sin /), usarlo directo
    try {
      if (statSync(skillDir).isDirectory()) return computeTreeHash(skillDir);
    } catch {}
    // Fallback: dirname del archivo
    return computeTreeHash(dirname(assetPath));
  }

  if (item.file.endsWith("/")) {
    return computeTreeHash(assetPath);
  }
  // Directorios sin trailing slash (ej: mcpServers) también son tree hash
  try {
    if (statSync(assetPath).isDirectory()) return computeTreeHash(assetPath);
  } catch {}
  return sha256(readFileSync(assetPath, "utf-8"));
}

/** Updates all manifest checksums or throws when --check finds drift. */
export function updateManifestHashes(projectRoot: string, checkOnly = false): boolean {
  const manifestPath = join(projectRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  let changed = false;

  const categories: Array<[keyof Manifest, string]> = [
    ["agents", "agents"],
    ["commands", "commands"],
    ["skills", "skills"],
    ["mcpServers", "mcpServers"],
  ];

  for (const [key, category] of categories) {
    for (const item of manifest[key] ?? []) {
      const hash = calculateHash(projectRoot, item as ManifestItem, category);
      if (item.sha256 !== hash) {
        if (checkOnly) throw new Error(`Hash desactualizado para ${item.file}`);
        (item as ManifestItem).sha256 = hash;
        changed = true;
      }
    }
  }

  if (changed) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return changed;
}

const scriptPath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isDirectRun) {
  const checkOnly = process.argv.includes("--check");
  const projectRoot = resolve(dirname(scriptPath), "..");
  try {
    // Workflow unificado: primero sincroniza versión, luego hashes
    const versionChanged = syncVersion(projectRoot, checkOnly);
    const hashChanged = updateManifestHashes(projectRoot, checkOnly);
    const changed = versionChanged || hashChanged;
    if (checkOnly) {
      console.log("Manifest verificado (versión + hashes)");
    } else {
      console.log(changed ? "Manifest actualizado (versión + hashes)" : "Manifest ya estaba actualizado");
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
