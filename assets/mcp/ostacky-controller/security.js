/**
 * security.js — source-of-truth mirror of src/security.ts for controller (Node)
 * Generado desde src/security.ts — mantener sincronizado via `bun run hash:check` y test controller-source
 */

export const SENSITIVE_DEFAULT = [
  "**/.env*",
  "**/.secrets/**",
  "**/*.pem",
  "**/*.key",
  "**/.aws/**",
  "**/.ssh/**",
  "**/credentials.json",
  "**/.npmrc",
];

export const BASH_SENSITIVE_RE =
  /(?:^|[^a-zA-Z0-9_.-])(\.env(\b|[_.-])|\.secrets\b|\.pem\b|\.key\b|credentials\.json|\.aws\b|\.ssh\b|\.npmrc\b)/i;

export function isSensitive(filePath, patterns = SENSITIVE_DEFAULT) {
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
  if (/\.(pem|key)$/i.test(normalized)) return true;
  if (base.startsWith(".env")) return true;
  return false;
}

export function extractPathsFromBash(cmd) {
  if (!cmd) return [];
  const normalized = cmd.replace(/&&/g, ";").replace(/\|\|/g, ";");
  const segments = normalized.split(/[|;><\n]+/);
  const paths = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const tokens = trimmed.match(/(?:[^\s"'`\\]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) || [];
    for (let token of tokens) {
      const stripped = token.replace(/["'`]/g, "").replace(/\\/g, "");
      if (!stripped) continue;
      if (["cat","grep","ls","echo","awk","sed","cut","head","tail","wc","find","xargs","bash","sh","zsh","env","printenv","node","bun","npm","npx","ls"].includes(stripped)) continue;
      if (stripped.startsWith("-")) continue;
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
        const cleaned = stripped.replace(/[,:;)\]]+$/, "");
        if (cleaned) paths.push(cleaned);
      } else if (stripped === ".env") {
        paths.push(stripped);
      }
    }
  }
  return [...new Set(paths)];
}

export function getSensitivePatterns() {
  const raw = process.env.OSTACKY_SENSITIVE_PATTERNS;
  if (!raw) return SENSITIVE_DEFAULT;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
