/**
 * Ostacky Guard — plugin hermano de Engram
 *
 * Bloquea lecturas sensibles sin autorización previa y bloquea cualquier tool
 * cuando el controller está en estado PENDING.
 *
 * Hard gate incluso en degraded: nunca uses bash para .env sin check_file_access → consume ALLOW con razón auditada.
 *
 * Se registra en `tool.execute.before` y lanza Error si la operación no está
 * permitida. OpenCode aborta el tool antes de tocar disco.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname, basename, resolve, relative } from "node:path"

const SENSITIVE_DEFAULT = [
  "**/.env*",
  "**/.secrets/**",
  "**/*.pem",
  "**/*.key",
  "**/.aws/**",
  "**/.ssh/**",
  "**/credentials.json",
  "**/.npmrc",
]

const BASH_SENSITIVE_RE =
  /(?:^|[^a-zA-Z0-9_.-])(\.env(\b|[_.-])|\.secrets\b|\.pem\b|\.key\b|credentials\.json|\.aws\b|\.ssh\b|\.npmrc\b)/i

function getEnvPatterns(): string[] {
  const raw = process.env.OSTACKY_SENSITIVE_PATTERNS
  if (!raw) return SENSITIVE_DEFAULT
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

function isSensitive(filePath: string, patterns: string[]): boolean {
  if (!filePath) return false
  const normalized = filePath.replace(/\\/g, "/")
  const lower = normalized.toLowerCase()
  if (lower.endsWith(".env.example") || lower.endsWith(".env.template") || lower.endsWith(".env.sample")) return false
  const base = lower.split("/").pop() || ""
  for (const pat of patterns) {
    if (pat.includes(".env") && base.startsWith(".env")) return true
    if (pat.includes(".secrets") && lower.includes(".secrets")) return true
    if (pat.includes("*.pem") && lower.endsWith(".pem")) return true
    if (pat.includes("*.key") && lower.endsWith(".key")) return true
    if (pat.includes(".aws") && lower.includes(".aws")) return true
    if (pat.includes(".ssh") && lower.includes(".ssh")) return true
    if (pat.includes("credentials.json") && lower.endsWith("credentials.json")) return true
    if (pat.includes(".npmrc") && lower.endsWith(".npmrc")) return true
  }
  if (/\.(pem|key)$/i.test(normalized)) return true
  if (base.startsWith(".env")) return true
  return false
}

function extractPathsFromBash(cmd: string): string[] {
  if (!cmd) return []
  const normalized = cmd.replace(/&&/g, ";").replace(/\|\|/g, ";")
  const segments = normalized.split(/[|;><\n]+/)
  const paths: string[] = []
  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    const tokens = trimmed.match(/(?:[^\s"'`\u0060\\]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) || []
    for (let token of tokens) {
      const stripped = token.replace(/["'`]/g, "").replace(/\\/g, "")
      if (!stripped) continue
      if (["cat","grep","ls","echo","awk","sed","cut","head","tail","wc","find","xargs","bash","sh","zsh","env","printenv","node","bun","npm","npx","ls","cat"].includes(stripped)) continue
      if (stripped.startsWith("-")) continue
      const lower = stripped.toLowerCase()
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
        const cleaned = stripped.replace(/[,:;)\]]+$/, "")
        if (cleaned) paths.push(cleaned)
      } else if (stripped === ".env") {
        paths.push(stripped)
      }
    }
  }
  return [...new Set(paths)]
}

function getStatePath(directory: string): string {
  if (process.env.OSTACKY_STATE_PATH) return process.env.OSTACKY_STATE_PATH
  const candidates = [join(directory, "opencode.json"), join(directory, "opencode.jsonc")]
  for (const cand of candidates) {
    try {
      const raw = readFileSync(cand, "utf-8")
      const json = JSON.parse(raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))
      const envPath = (json as any)?.mcp?.["ostacky-controller"]?.environment?.OSTACKY_STATE_PATH
      if (typeof envPath === "string" && envPath) return envPath
    } catch {}
  }
  return join(directory, ".opencode", "ostacky-state.json")
}

function readState(directory: string): any | null {
  const p = getStatePath(directory)
  try {
    const raw = readFileSync(p, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const OstackyGuard: Plugin = async (ctx) => {
  const patterns = getEnvPatterns()

  return {
    "tool.execute.before": async (input, output) => {
      const tool = (input as any).tool as string
      const args = (input as any).args as any

      // 10.2: Guard genérico de PENDING — bloquear cualquier tool no-controller cuando estado es PENDING
      const state = readState(ctx.directory)
      const pendingStates = ["ROUTE_DECISION_PENDING", "EXECUTION_DECISION_PENDING", "CLARIFICATION_PENDING"]
      if (state && pendingStates.includes(state.state)) {
        const allowedTools = ["consume_route_decision", "consume_execution_decision", "record_clarification", "abandon", "check_file_access", "consume_file_access_decision", "record_user_confirmation"]
        const isControllerTool = tool.startsWith("ostacky-controller_") || allowedTools.some((t) => tool.includes(t))
        if (!isControllerTool) {
          throw new Error(`BLOCKED: call consume_* first — controller is in ${state.state}. Use consume_route_decision / consume_execution_decision / record_clarification to proceed.`)
        }
      }

      // ── Guard hard para bash/write/edit (hardening-v2 P0) ──
      // Hard gate incluso en degraded, nunca uses bash para .env sin check_file_access → consume ALLOW con razón auditada
      if (tool === "bash") {
        const cmd: string = args?.command || args?.cmd || ""
        if (typeof cmd === "string" && cmd) {
          const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "")
          const hasSensitivePattern = BASH_SENSITIVE_RE.test(normalized)
          const paths = extractPathsFromBash(cmd)
          const sensitivePaths = paths.filter((p) => isSensitive(p, patterns))
          // Si hay match de regex o paths sensibles, validar ALLOW
          if (hasSensitivePattern || sensitivePaths.length > 0) {
            // Si extrajimos paths sensibles, validar cada uno
            if (sensitivePaths.length > 0) {
              for (const p of sensitivePaths) {
                const s = readState(ctx.directory)
                // Normalizar p para lookup: probar p tal cual, y resolved, y basename para casos relativos
                const candidates = [p, resolve(ctx.directory, p), join(ctx.directory, p)]
                const allowed = candidates.some((c) => s?.allowedFiles?.[c] || s?.allowedFiles?.[p])
                // También chequear por basename si es .env (ej: .env vs /abs/.env)
                const baseAllowed = s?.allowedFiles?.[p] || s?.allowedFiles?.[basename(p)] || s?.allowedFiles?.[resolve(ctx.directory, p)]
                if (!allowed && !baseAllowed) {
                  const denied = s?.deniedFiles?.[p] || s?.deniedFiles?.[basename(p)]
                  if (denied) {
                    throw new Error(`BLOCKED: bash contiene acceso sensible (${p}) (previously denied) — Llamá check_file_access con reason antes.`)
                  }
                  throw new Error(`BLOCKED: bash contiene acceso sensible (${p}). Llamá check_file_access con reason antes.`)
                }
              }
            } else if (hasSensitivePattern) {
              // Fallback genérico cuando regex matchea pero no extrajimos path (ej: cat .env con espacios raros)
              const s = readState(ctx.directory)
              // Buscar si hay algún allowed que cubra .env* genérico
              const hasAllowed = Object.keys(s?.allowedFiles || {}).some((k) => isSensitive(k, patterns))
              if (!hasAllowed) {
                throw new Error(`BLOCKED: bash contiene acceso sensible (.env). Llamá check_file_access con reason antes.`)
              }
            }
          }
          // Caso especial: obfuscación .e""nv → normalized ya quitó quotes, pero paths extraído ya lo cubre
          // Si normalized contiene .env después de strip, y no hay allowed, ya bloqueamos arriba
        }
      }

      // Extraer filePath para read/write/edit/grep/glob/read_mcp_resource
      let filePath: string | undefined
      if (tool === "read" || tool === "read_mcp_resource" || tool === "grep" || tool === "glob" || tool === "write" || tool === "edit") {
        filePath = args?.filePath || args?.path || args?.pattern || args?.uri || ""
        if (tool === "grep" && args?.include) filePath = args.include
        if (tool === "write" || tool === "edit") {
          filePath = args?.filePath || args?.path || ""
        }
        if (tool === "read_mcp_resource" && typeof args?.uri === "string") {
          try {
            const u = args.uri as string
            if (u.startsWith("file://")) filePath = u.slice(7)
            else if (u.includes("/")) filePath = u
          } catch {}
        }
      }

      // 9.1: Guard de credenciales (hard gate incluso en degraded)
      if (filePath && isSensitive(filePath, patterns)) {
        const s = readState(ctx.directory)
        const allowed = s?.allowedFiles?.[filePath] || s?.allowedFiles?.[resolve(ctx.directory, filePath)] || s?.allowedFiles?.[basename(filePath)]
        if (!allowed) {
          const denied = s?.deniedFiles?.[filePath] || s?.deniedFiles?.[basename(filePath)]
          if (denied) {
            throw new Error(`BLOCKED: File ${filePath} requires check_file_access (previously denied)`)
          }
          throw new Error(`BLOCKED: File ${filePath} requires check_file_access`)
        }
      }
    },
  }
}
