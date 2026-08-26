/**
 * Ostacky Guard — plugin hermano de Engram
 *
 * Bloquea lecturas sensibles sin autorización previa y bloquea cualquier tool
 * cuando el controller está en estado PENDING.
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

function getEnvPatterns(): string[] {
  const raw = process.env.OSTACKY_SENSITIVE_PATTERNS
  if (!raw) return SENSITIVE_DEFAULT
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

function isSensitive(filePath: string, patterns: string[]): boolean {
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".env.example") || lower.endsWith(".env.template") || lower.endsWith(".env.sample")) return false
  for (const pat of patterns) {
    if (pat.includes(".env") && lower.split("/").pop()!.startsWith(".env")) return true
    if (pat.includes(".secrets") && lower.includes(".secrets")) return true
    if (pat.includes("*.pem") && lower.endsWith(".pem")) return true
    if (pat.includes("*.key") && lower.endsWith(".key")) return true
    if (pat.includes(".aws") && lower.includes(".aws")) return true
    if (pat.includes(".ssh") && lower.includes(".ssh")) return true
    if (pat.includes("credentials.json") && lower.endsWith("credentials.json")) return true
    if (pat.includes(".npmrc") && lower.endsWith(".npmrc")) return true
  }
  if (/\.(pem|key)$/i.test(filePath)) return true
  if (filePath.includes(".env")) {
    const base = filePath.split("/").pop() || ""
    if (base.startsWith(".env")) return true
  }
  return false
}

function getStatePath(directory: string): string {
  if (process.env.OSTACKY_STATE_PATH) return process.env.OSTACKY_STATE_PATH
  // try opencode.json
  const candidates = [join(directory, "opencode.json"), join(directory, "opencode.jsonc")]
  for (const cand of candidates) {
    try {
      const raw = readFileSync(cand, "utf-8")
      // naive parse, ignore comments
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

      // Extraer filePath de args según tool
      let filePath: string | undefined
      if (tool === "read" || tool === "read_mcp_resource" || tool === "grep" || tool === "glob") {
        filePath = args?.filePath || args?.path || args?.pattern || args?.uri || ""
        // Para grep, el pattern puede ser contenido, no file; intentar detectar file
        if (tool === "grep" && args?.include) filePath = args.include
        if (tool === "read_mcp_resource" && typeof args?.uri === "string") {
          // uri puede ser file:// o path
          try {
            const u = args.uri as string
            if (u.startsWith("file://")) filePath = u.slice(7)
            else if (u.includes("/") ) filePath = u
          } catch {}
        }
      }

      // 10.2: Guard genérico de PENDING — bloquear cualquier tool no-controller cuando estado es PENDING
      const state = readState(ctx.directory)
      const pendingStates = ["ROUTE_DECISION_PENDING", "EXECUTION_DECISION_PENDING", "CLARIFICATION_PENDING"]
      if (state && pendingStates.includes(state.state)) {
        // Permitir solo tools del controller que desbloquean
        const allowedTools = ["consume_route_decision", "consume_execution_decision", "record_clarification", "abandon", "check_file_access", "consume_file_access_decision", "record_user_confirmation"]
        const isControllerTool = tool.startsWith("ostacky-controller_") || allowedTools.some((t) => tool.includes(t))
        if (!isControllerTool) {
          // Bloquear cualquier tool no-controller (Read/Grep/Glob/Bash/Edit/Write) cuando está en PENDING — hard gate genérico
          throw new Error(`BLOCKED: call consume_* first — controller is in ${state.state}. Use consume_route_decision / consume_execution_decision / record_clarification to proceed.`)
        }
      }

      // 9.1: Guard de credenciales
      if (filePath && isSensitive(filePath, patterns)) {
        const s = readState(ctx.directory)
        const allowed = s?.allowedFiles?.[filePath]
        if (!allowed) {
          const denied = s?.deniedFiles?.[filePath]
          if (denied) {
            throw new Error(`BLOCKED: File ${filePath} requires check_file_access (previously denied)`)
          }
          throw new Error(`BLOCKED: File ${filePath} requires check_file_access`)
        }
      }
    },
  }
}
