/**
 * Check de última versión + migración v1→v2 para `npx ostacky` bare.
 * - Consulta npm registry (`ostacky@latest`, 5s timeout, nunca bloquea).
 * - Si la instalada es major 1 y hay v2 disponible → ofrece desinstalar v1 e instalar v2.
 * - Si hay versión más nueva → ofrece re-ejecutar con `ostacky@latest`.
 * - Sin red, no-interactivo o `--yes` → sigue al menú sin preguntar (default seguro: No).
 */

export function parseMajor(version: string | null | undefined): number | null {
  if (!version) return null;
  const m = /v?(\d+)\.\d+\.\d+/.exec(version.trim());
  if (!m) return null;
  const major = parseInt(m[1], 10);
  return Number.isNaN(major) ? null : major;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

/** Consulta la versión `latest` publicada en npm. Retorna null si falla (sin red, timeout). */
export async function fetchLatestNpmVersion(
  pkg: string = "ostacky",
  timeoutMs: number = 5000
): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "ostacky-installer" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export interface UpdateOffer {
  kind: "migrate-v1" | "update-available" | "none";
  installed: string;
  latest: string | null;
}

/** Decide qué ofrecer sin hacer I/O de red: pura, testeable. */
export function decideOffer(installed: string, latest: string | null): UpdateOffer {
  if (!latest || compareVersions(installed, latest) >= 0) {
    return { kind: "none", installed, latest };
  }
  if (parseMajor(installed) === 1) {
    return { kind: "migrate-v1", installed, latest };
  }
  return { kind: "update-available", installed, latest };
}

/** True cuando se puede preguntar (interactivo y sin flags de auto). */
export function canPrompt(argv: string[] = process.argv, isTTY: boolean = process.stdin.isTTY === true): boolean {
  if (!isTTY) return false;
  return !argv.includes("--yes") && !argv.includes("--no-interactive") && !argv.includes("--non-interactive");
}
