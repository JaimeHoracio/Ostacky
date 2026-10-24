import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compila cada `mcpServers[]` del manifest a `dist/mcp/<name>/index.js`
 * autocontenido (sin `node_modules` al lado).
 *
 * El installer prefiere ese artefacto y, si no existe, cae al fallback dev
 * (copiar `assets/mcp/<name>/` + `bun install`/`npm install` en el install).
 * Ese fallback depende de red y de un package manager en la máquina del usuario:
 * el bundle lo elimina del camino normal.
 */

interface ManifestItem {
  name: string;
  file: string;
}

interface Manifest {
  mcpServers?: ManifestItem[];
}

export interface BuiltBundle {
  name: string;
  outfile: string;
  bytes: number;
}

export async function buildMcpBundles(
  projectRoot: string,
  outDir: string = join(projectRoot, "dist", "mcp")
): Promise<BuiltBundle[]> {
  const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf-8")) as Manifest;
  const servers = manifest.mcpServers ?? [];
  const results: BuiltBundle[] = [];

  for (const item of servers) {
    const entry = join(projectRoot, "assets", "mcp", item.name, "index.js");
    if (!existsSync(entry)) throw new Error(`Entry del MCP no encontrado: ${entry}`);

    const destDir = join(outDir, item.name);
    mkdirSync(destDir, { recursive: true });

    const build = await Bun.build({
      entrypoints: [entry],
      target: "node",
      format: "esm",
      outdir: destDir,
    });
    if (!build.success) {
      const detail = build.logs.map((log) => log.message).join("\n");
      throw new Error(`Falló el bundle de ${item.name}:\n${detail}`);
    }

    const outfile = join(destDir, "index.js");
    if (!existsSync(outfile)) {
      throw new Error(`El bundle de ${item.name} no generó index.js en ${destDir}`);
    }

    // El artefacto se ejecuta con node: sin type:module, node puede parsear el
    // .js como CJS y el MCP no arranca (los imports ESM quedan sin resolver).
    writeFileSync(join(destDir, "package.json"), JSON.stringify({ type: "module" }) + "\n", "utf-8");

    results.push({ name: item.name, outfile, bytes: readFileSync(outfile).length });
  }

  return results;
}

const scriptPath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isDirectRun) {
  const projectRoot = resolve(dirname(scriptPath), "..");
  try {
    const built = await buildMcpBundles(projectRoot);
    if (built.length === 0) {
      console.log("No hay mcpServers en el manifest — nada que bundlear");
    }
    for (const bundle of built) {
      console.log(`  ${bundle.name} → ${relative(projectRoot, bundle.outfile)} (${Math.round(bundle.bytes / 1024)} KB)`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
