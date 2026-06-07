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
