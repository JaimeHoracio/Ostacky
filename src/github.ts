import localManifest from "../manifest.json" assert { type: "json" };
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getCached, putCache } from "./cache.js";
import { validateFilePath, verifyChecksum } from "./security.js";

export interface ManifestItem {
  name: string;
  file: string;
  description: string;
  version: string;
  sha256: string | null;
}

export interface Manifest {
  version: string;
  repo: string;
  /** Tag de GitHub (e.g. "v0.0.1"). Reemplaza el uso de branch. */
  tag: string;
  agents: ManifestItem[];
  commands: ManifestItem[];
  skills: ManifestItem[];
}

const GITHUB_RAW = "https://raw.githubusercontent.com";
const GITHUB_API = "https://api.github.com";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Raíz del paquete: un nivel arriba de dist/ (prod) o src/ (dev). */
export const PACKAGE_ROOT = join(__dirname, "..");

/** Directorio donde viven las skills bundleadas. */
export const BUNDLED_SKILLS_DIR = join(PACKAGE_ROOT, "assets", "skills");

/**
 * Devuelve la ruta absoluta al directorio bundleado de una skill.
 * Lanza si el nombre contiene segmentos inseguros.
 */
export function getBundledSkillPath(name: string): string {
  validateFilePath(name);
  return join(BUNDLED_SKILLS_DIR, name);
}

export function getRawUrl(repo: string, tag: string, path: string): string {
  return `${GITHUB_RAW}/${repo}/${tag}/${path}`;
}

/**
 * Consulta la GitHub Releases API para obtener el tag de la última release.
 * Retorna null si no hay releases o la petición falla.
 */
export async function fetchLatestTag(repo: string): Promise<string | null> {
  try {
    const url = `${GITHUB_API}/repos/${repo}/releases/latest`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "ostacky-installer" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Descarga el manifest para un tag específico desde GitHub.
 * Cae al manifest local si la petición falla.
 */
export async function fetchManifest(tag?: string): Promise<Manifest> {
  const resolvedTag = tag ?? localManifest.tag;
  try {
    const url = getRawUrl(localManifest.repo, resolvedTag, "manifest.json");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "ostacky-installer" },
    });
    if (response.ok) {
      return (await response.json()) as Manifest;
    }
  } catch {
    // Network error o timeout — usa el manifest local
  }
  return localManifest as Manifest;
}

/**
 * Busca la última release en GitHub y descarga su manifest.
 * Retorna el manifest y si hay una versión más nueva que la bundled.
 */
export async function fetchLatestManifest(): Promise<{
  manifest: Manifest;
  isNew: boolean;
  latestTag: string | null;
}> {
  const latestTag = await fetchLatestTag(localManifest.repo);
  const currentTag = localManifest.tag;
  const isNew = latestTag !== null && latestTag !== currentTag;
  const manifest = await fetchManifest(latestTag ?? currentTag);
  return { manifest, isNew, latestTag };
}

/**
 * Descarga un archivo del repo de GitHub.
 * - Primero consulta el cache local (valida checksum si está disponible).
 * - Valida el path para prevenir path traversal.
 * - Verifica checksum SHA-256 si el manifest lo incluye.
 * - Guarda en cache tras una descarga exitosa.
 */
export async function downloadFile(
  manifest: Manifest,
  filePath: string
): Promise<string> {
  validateFilePath(filePath);

  const item = [...manifest.agents, ...manifest.commands, ...(manifest.skills ?? [])]
    .find((i) => i.file === filePath);
  const expectedHash = item?.sha256 ?? null;

  // Intenta servir desde cache
  const cached = getCached(manifest.repo, manifest.tag, filePath, expectedHash);
  if (cached !== null) return cached;

  const url = getRawUrl(manifest.repo, manifest.tag, filePath);
  const response = await fetch(url, {
    headers: { "User-Agent": "ostacky-installer" },
  });
  if (!response.ok) {
    throw new Error(
      `Error descargando ${url}: ${response.status} ${response.statusText}`
    );
  }

  const content = await response.text();

  // Valida integridad
  verifyChecksum(content, expectedHash, filePath);

  // Guarda en cache para usos futuros
  putCache(manifest.repo, manifest.tag, filePath, content);

  return content;
}
