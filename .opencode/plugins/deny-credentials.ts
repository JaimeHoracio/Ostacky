import type { Plugin } from "@opencode-ai/plugin";

const CONTROL_PREFIX = ">>>> Control: No se puede leer o modificar las credenciales";

function normalizePath(value: string): string {
  return value.replace(/\\+/g, "/");
}

function hasGlobChars(value: string): boolean {
  return /[*?\[\]]/.test(value);
}

function isSensitivePath(value: string): boolean {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.length > 0 ? segments[segments.length - 1] : normalized;

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    segments.includes(".secret")
  );
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];

  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry, seen));
  }

  return Object.values(value).flatMap((entry) => collectStrings(entry, seen));
}

function extractSensitiveTarget(value: unknown): string | undefined {
  const candidates = collectStrings(value);

  const exactMatch = candidates.find((candidate) => !hasGlobChars(candidate) && isSensitivePath(candidate));
  if (exactMatch) return exactMatch;

  return candidates.find(isSensitivePath);
}

function formatMessage(target: string): string {
  return `${CONTROL_PREFIX}: "${target}"`;
}

export default (async () => {
  const logged = new Set<string>();

  const warnOnce = (key: string, target: string) => {
    if (logged.has(key)) return;

    logged.add(key);
    console.warn(formatMessage(target));
  };

  return {
    event: async ({ event }) => {
      if (event.type !== "permission.updated") return;

      const target = extractSensitiveTarget(event.properties) ?? extractSensitiveTarget(event.properties.metadata);
      if (!target) return;

      warnOnce(event.properties.id, target);
    },
    "permission.ask": async (input, output) => {
      const target = extractSensitiveTarget(input) ?? extractSensitiveTarget(input.metadata);
      if (!target) return;

      output.status = "deny";
      warnOnce(input.id, target);
    },
  };
}) satisfies Plugin;
