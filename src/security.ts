import { createHash } from "crypto";

/**
 * Validates a relative file path to prevent path traversal attacks.
 * Throws if the path contains ".." segments, starts with "/" or "\"
 * or looks like an absolute Windows path (e.g. "C:\...").
 */
export function validateFilePath(filePath: string): void {
  if (
    filePath.includes("..") ||
    filePath.startsWith("/") ||
    filePath.startsWith("\\") ||
    /^[a-zA-Z]:/.test(filePath)
  ) {
    throw new Error(`Ruta de archivo inválida: "${filePath}"`);
  }
}

/**
 * Returns the SHA-256 hex digest of a UTF-8 string.
 */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Verifies content against an expected SHA-256 checksum.
 * No-op when expectedHash is null/undefined (checksum opcional).
 */
export function verifyChecksum(
  content: string,
  expectedHash: string | null | undefined,
  label: string
): void {
  if (!expectedHash) return;
  const actual = sha256(content);
  if (actual !== expectedHash) {
    throw new Error(
      `Checksum inválido para "${label}"\n  esperado: ${expectedHash}\n  recibido: ${actual}`
    );
  }
}

// ─── Sensitive guard — source-of-truth (hardening-v2 D1) ───────────────

export const SENSITIVE_DEFAULT: string[] = [
  "**/.env*",
  "**/.secrets/**",
  "**/*.pem",
  "**/*.key",
  "**/.aws/**",
  "**/.ssh/**",
  "**/credentials.json",
  "**/.npmrc",
];

/**
 * Regex que detecta acceso sensible en comandos bash.
 * Cubre .env, .secrets, .pem, .key, .aws, .ssh, credentials.json, .npmrc
 * Normalizar antes (strip quotes/backslashes) y testear con `BASH_SENSITIVE_RE.test(normalized)`.
 */
export const BASH_SENSITIVE_RE =
  /(?:^|[^a-zA-Z0-9_.-])(\.env(\b|[_.-])|\.secrets\b|\.pem\b|\.key\b|credentials\.json|\.aws\b|\.ssh\b|\.npmrc\b)/i;

/**
 * Returns true if filePath is considered sensitive given patterns.
 * - Allowlist: .env.example / .env.template / .env.sample nunca son sensibles.
 * - Normaliza backslashes a "/" para Windows.
 * - patterns: array de globs como SENSITIVE_DEFAULT; si no se pasa usa SENSITIVE_DEFAULT.
 */
export function isSensitive(filePath: string, patterns: string[] = SENSITIVE_DEFAULT): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (
    lower.endsWith(".env.example") ||
    lower.endsWith(".env.template") ||
    lower.endsWith(".env.sample")
  )
    return false;
  const base = lower.split("/").pop() || "";
  for (const pat of patterns) {
    if (pat.includes(".env") && base.startsWith(".env")) return true;
    if (pat.includes(".secrets") && lower.includes(".secrets")) return true;
    if (pat.includes("*.pem") && lower.endsWith(".pem")) return true;
    if (pat.includes("*.key") && lower.endsWith(".key")) return true;
    if (pat.includes(".aws") && lower.includes(".aws")) return true;
    if (pat.includes(".ssh") && lower.includes(".ssh")) return true;
    if (pat.includes("credentials.json") && lower.endsWith("credentials.json")) return true;
    if (pat.includes(".npmrc") && lower.endsWith(".npmrc")) return true;
  }
  // fallback genérico por extensión
  if (/\.(pem|key)$/i.test(normalized)) return true;
  if (base.startsWith(".env")) return true;
  return false;
}

/**
 * Extrae paths candidatos de un comando bash para chequear sensibilidad.
 * Tokeniza por separadores shell `| ; && || > >> <` y respeta quotes.
 * Normaliza quitando quotes y backslashes para detectar obfuscaciones como .e""nv.
 */
export function extractPathsFromBash(cmd: string): string[] {
  if (!cmd) return [];
  // Normalizar && y || a ; para split único
  const normalized = cmd.replace(/&&/g, ";").replace(/\|\|/g, ";");
  // Split por separadores shell
  const segments = normalized.split(/[|;><\n]+/);
  const paths: string[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    // Tokeniza respetando quotes — captura tokens entre quotes o sin espacios
    const tokens = trimmed.match(/(?:[^\s"'`\\]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) || [];
    for (let token of tokens) {
      // Normalización anti-obfuscación: quitar quotes y backslashes
      const stripped = token.replace(/["'`]/g, "").replace(/\\/g, "");
      if (!stripped) continue;
      // Filtrar comandos comunes y flags
      if (["cat", "grep", "ls", "echo", "awk", "sed", "cut", "head", "tail", "wc", "find", "xargs", "bash", "sh", "zsh", "env", "printenv", "node", "bun", "npm", "npx", "ls"].includes(stripped)) continue;
      if (stripped.startsWith("-")) continue;
      // Heurística de path: contiene / o . o es .env* o sensible
      const lower = stripped.toLowerCase();
      if (
        stripped.includes("/") ||
        stripped.includes(".") ||
        lower.startsWith(".env") ||
        lower.includes(".secrets") ||
        lower.endsWith(".pem") ||
        lower.endsWith(".key") ||
        lower.includes(".aws") ||
        lower.includes(".ssh") ||
        lower.endsWith("credentials.json") ||
        lower.endsWith(".npmrc")
      ) {
        // Limpiar trailing chars como : , )
        const cleaned = stripped.replace(/[,:;)\]]+$/, "");
        if (cleaned) paths.push(cleaned);
      } else if (stripped === ".env") {
        paths.push(stripped);
      }
    }
  }
  // También buscar paths con regex global como fallback
  // (detecta .env en strings complejos)
  return [...new Set(paths)];
}

/**
 * Lee patrones sensibles desde env OSTACKY_SENSITIVE_PATTERNS o usa default.
 */
export function getSensitivePatterns(): string[] {
  const raw = process.env.OSTACKY_SENSITIVE_PATTERNS;
  if (!raw) return SENSITIVE_DEFAULT;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
