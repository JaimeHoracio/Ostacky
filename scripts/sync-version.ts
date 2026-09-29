import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface VersionedItem {
  version?: string;
}

interface Manifest {
  version?: string;
  tag?: string;
  agents?: VersionedItem[];
  commands?: VersionedItem[];
  mcpServers?: VersionedItem[];
  skills?: VersionedItem[];
}

/**
 * Synchronizes package.json's version into manifest.json before builds.
 * Returns whether the manifest changed.
 * If checkOnly is true, throws when version is stale instead of writing.
 */
export function syncVersion(projectRoot: string, checkOnly = false): boolean {
  const packagePath = join(projectRoot, "package.json");
  const manifestPath = join(projectRoot, "manifest.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as { version?: unknown };
  const version = typeof packageJson.version === "string" ? packageJson.version : "";
  if (!version) throw new Error(`package.json no contiene una versión válida: ${packagePath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  let changed = false;
  const update = (target: VersionedItem) => {
    if (target.version !== version) {
      target.version = version;
      changed = true;
    }
  };

  if (manifest.version !== version) {
    manifest.version = version;
    changed = true;
  }
  const tag = `v${version}`;
  if (manifest.tag !== tag) {
    manifest.tag = tag;
    changed = true;
  }
  for (const items of [manifest.agents, manifest.commands, manifest.mcpServers, manifest.skills]) {
    for (const item of items ?? []) update(item);
  }

  if (changed) {
    if (checkOnly) throw new Error(`Versión desactualizada en manifest.json (esperado ${version}, tag v${version})`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  // Sincronizar versión al agente para que sepa responder "qué versión tenés"
  try {
    const agentPath = join(projectRoot, "assets", "agents", "ostacky.md");
    let agentContent = readFileSync(agentPath, "utf-8");
    const original = agentContent;
    // frontmatter version: version: x.y.z
    if (/^version:\s*.*$/m.test(agentContent)) {
      agentContent = agentContent.replace(/^version:\s*.*$/m, `version: ${version}`);
    } else if (/^---\s*\n/.test(agentContent)) {
      // insert after first --- block
      agentContent = agentContent.replace(/^(---\s*\n[^\-]*?)(\n---)/m, `$1version: ${version}$2`);
    }
    // body: Sos **Ostacky vX.Y.Z**
    agentContent = agentContent.replace(/Sos \*\*Ostacky v[^*]+\*\*/, `Sos **Ostacky v${version}**`);
    // Versión: `x.y.z` — preciso solo el primer backtick tras **Versión:**
    agentContent = agentContent.replace(/(> \*\*Versión:\*\* `)[^`]+(`)/, `$1${version}$2`);
    agentContent = agentContent.replace(/"Ostacky v[^"]+"/, `"Ostacky v${version}"`);
    agentContent = agentContent.replace(/`v[^`]+` si te piden solo el número/, `\`v${version}\` si te piden solo el número`);
    if (agentContent !== original) {
      if (checkOnly) throw new Error(`Versión desactualizada en ${agentPath}`);
      writeFileSync(agentPath, agentContent, "utf-8");
      changed = true;
    }
  } catch (e) {
    if (checkOnly && e instanceof Error && e.message.startsWith("Versión desactualizada")) throw e;
  }

  return changed;
}

const scriptPath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isDirectRun) {
  const checkOnly = process.argv.includes("--check");
  const projectRoot = resolve(dirname(scriptPath), "..");
  try {
    const changed = syncVersion(projectRoot, checkOnly);
    console.log(checkOnly ? "Versiones verificadas" : changed ? "Versiones sincronizadas en manifest.json" : "Versiones ya estaban sincronizadas");
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
