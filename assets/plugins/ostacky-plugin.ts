/**
 * Ostacky Controller — Plugin híbrido como alma
 *
 * Fusiona assets/mcp/ostacky-controller/index.js + assets/plugins/ostacky-guard.ts
 * Mantiene máquina de 13 estados en-process y aplica hard gates en tool.execute.before.
 * MCP queda thin solo para observabilidad (get_*).
 *
 * Single source security: importa desde src/security.ts (no copia regex).
 * Cache único: getDiscoverySnapshot es único entrypoint.
 * Tiered cache-friendly: isTrivial sin reemplazar system[0], suffix hint + SKIP.
 * CodeGraph preventivo: bloquea Read/Grep masivo sin Discovery hit.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs"
import { join, dirname, basename, resolve, relative } from "node:path"
import { SENSITIVE_DEFAULT, BASH_SENSITIVE_RE, isSensitive, extractPathsFromBash } from "../../src/security.ts"
import { isTrivial } from "../../src/tiered.ts"

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_STATE_FILE_SIZE = 2 * 1024 * 1024

const STATES = Object.freeze({
  INTERPRETATION_PENDING: "INTERPRETATION_PENDING",
  CLARIFICATION_PENDING: "CLARIFICATION_PENDING",
  DISCOVERY: "DISCOVERY",
  ROUTE_DECISION_PENDING: "ROUTE_DECISION_PENDING",
  SPECIFICATION: "SPECIFICATION",
  EXECUTION_ANALYSIS: "EXECUTION_ANALYSIS",
  EXECUTION_DECISION_PENDING: "EXECUTION_DECISION_PENDING",
  EXECUTING_INLINE: "EXECUTING_INLINE",
  EXECUTING_SUBAGENTS: "EXECUTING_SUBAGENTS",
  SYNC: "SYNC",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
} as const)

const TRANSITIONS: Record<string, Array<{ via: string; to: string; choice?: string; mode?: string }>> = {
  INTERPRETATION_PENDING: [
    { via: "request_clarification", to: "CLARIFICATION_PENDING" },
    { via: "proceed_to_discovery", to: "DISCOVERY" },
    { via: "record_discovery", to: "ROUTE_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
  ],
  CLARIFICATION_PENDING: [
    { via: "record_clarification", to: "DISCOVERY" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  DISCOVERY: [
    { via: "record_discovery", to: "ROUTE_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  ROUTE_DECISION_PENDING: [
    { via: "consume_route_decision", to: "SPECIFICATION", choice: "SPEC" },
    { via: "consume_route_decision", to: "EXECUTION_ANALYSIS", choice: "DIRECT" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  SPECIFICATION: [
    { via: "spec_complete", to: "EXECUTION_ANALYSIS" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTION_ANALYSIS: [
    { via: "record_execution_analysis", to: "EXECUTION_DECISION_PENDING" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTION_DECISION_PENDING: [
    { via: "consume_execution_decision", to: "EXECUTING_INLINE", mode: "INLINE" },
    { via: "consume_execution_decision", to: "EXECUTING_SUBAGENTS", mode: "SUBAGENT_DRIVEN" },
    { via: "block", to: "BLOCKED" },
    { via: "abandon", to: "BLOCKED" },
  ],
  EXECUTING_INLINE: [
    { via: "implementation_complete", to: "SYNC" },
    { via: "block", to: "BLOCKED" },
  ],
  EXECUTING_SUBAGENTS: [
    { via: "implementation_complete", to: "SYNC" },
    { via: "block", to: "BLOCKED" },
  ],
  BLOCKED: [
    { via: "replan", to: "INTERPRETATION_PENDING" },
    { via: "abandon", to: "DONE" },
  ],
  SYNC: [
    { via: "sync_complete", to: "DONE" },
    { via: "block", to: "BLOCKED" },
  ],
  DONE: [],
}

const DEFAULT_STATE: any = {
  state: STATES.INTERPRETATION_PENDING,
  revision: 0,
  requestId: null,
  changeId: null,
  routeDecisionId: null,
  routeChoice: null,
  level: null,
  executionDecisionId: null,
  executionMode: null,
  snapshots: { codegraph: null, execution: null },
  tasks: {},
  fileFingerprints: {},
  error: null,
  lastHandoff: null,
  expectedTasks: null,
  expectedTaskCount: null,
  auditSeq: 0,
  degraded: false,
  schemaVersion: 1,
  stateOversizedCount: 0,
  codegraphBypassCount: 0,
  degradedEditsCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0,
  tokenSavingEstimate: 0,
  discoveryCacheHitCount: 0,
  redundantCallCount: 0,
  cacheMissWithoutPutCount: 0,
  stateCheckCount: 0,
  toolCallCount: 0,
  lastProposal: null,
  allowedFiles: {},
  deniedFiles: {},
  sensitivePatterns: SENSITIVE_DEFAULT,
  sensitiveAccess: { allowed: 0, denied: 0, blockedAttempts: 0 },
  staleContentAttempts: 0,
  completeWithoutValidateCount: 0,
  toolTimeoutCount: 0,
  lastToolDurationMs: 0,
  stateDurationMs: 0,
  subagentFailedCount: 0,
  lastValidated: null,
  pendingFileAccess: {},
  lastHeartbeat: 0,
  watchdogEnabled: true,
  ts: Date.now(),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function persistState(directory: string, state: any): void {
  const p = getStatePath(directory)
  const dir = dirname(p)
  try { mkdirSync(dir, { recursive: true }) } catch {}
  let serialized = JSON.stringify(state, null, 2)
  if (serialized.length > MAX_STATE_FILE_SIZE) {
    state.stateOversizedCount = (state.stateOversizedCount || 0) + 1
    const trimmed = { ...state, snapshots: { codegraph: null, execution: null }, audit: (state.audit || []).slice(-50) }
    serialized = JSON.stringify(trimmed, null, 2)
    if (serialized.length > MAX_STATE_FILE_SIZE) return
    state.snapshots = { codegraph: null, execution: null }
    serialized = JSON.stringify(state, null, 2)
  }
  const tmp = p + ".tmp." + process.pid
  try {
    writeFileSync(tmp, serialized, "utf-8")
    renameSync(tmp, p)
    try { renameSync(p + ".backup", p + ".backup.1") } catch {}
    try { renameSync(p + ".backup.1", p + ".backup.2") } catch {}
    try {
      const backupTmp = p + ".backup.tmp." + process.pid
      writeFileSync(backupTmp, serialized, "utf-8")
      renameSync(backupTmp, p + ".backup")
    } catch {}
  } catch {}
}

function fastFingerprint(filePath: string): string | null {
  try {
    const s = statSync(filePath)
    return `${s.mtimeMs}-${s.size}`
  } catch { return null }
}

function isPathInsideProject(filePath: string, directory: string): boolean {
  if (!filePath) return true
  try {
    const projectRoot = directory
    const resolved = resolve(projectRoot, filePath)
    const rel = relative(projectRoot, resolved)
    if (rel.startsWith("..")) return false
    if (resolve(filePath) !== resolved && filePath.startsWith("/")) {
      const absRel = relative(projectRoot, resolve(filePath))
      if (absRel.startsWith("..")) return false
    }
    return true
  } catch { return false }
}

function getDiscoveryCacheHit(directory: string): boolean {
  try {
    const cacheDir = join(directory, ".opencode", "cache", "codegraph")
    if (!existsSync(cacheDir)) return false
    const files = readdirSync(cacheDir).filter(f => f.startsWith("discovery-"))
    if (files.length === 0) return false
    // check if any file is recent (<1h) and valid
    const now = Date.now()
    for (const f of files) {
      try {
        const raw = readFileSync(join(cacheDir, f), "utf-8")
        const data = JSON.parse(raw)
        if (typeof data.ts === "number" && now - data.ts < 60*60*1000) return true
      } catch {}
    }
    return false
  } catch { return false }
}

function isCodegraphAvailable(directory: string): boolean {
  // If codegraph binary exists, assume OK. Otherwise fallback allows Read.
  try {
    const bin = join(directory, ".opencode", "tools", "codegraph", "bin", "codegraph")
    const binExe = bin + ".exe"
    if (existsSync(bin) || existsSync(binExe)) return true
    // also check global which
    const which = (Bun as any).which?.("codegraph")
    if (which) return true
    return false
  } catch { return false }
}

// Track trivial flag per session to gate tools
const trivialBySession = new Map<string, boolean>()
// Track discovery hit per requestId to avoid blocking after hit
const discoveryHitByRequest = new Map<string, boolean>()

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const OstackyController: Plugin = async (ctx) => {
  const patterns = (() => {
    const raw = process.env.OSTACKY_SENSITIVE_PATTERNS
    if (!raw) return SENSITIVE_DEFAULT
    return raw.split(",").map(s => s.trim()).filter(Boolean)
  })()

  let lastCheck: { revision: number; result: string } | null = null
  let checkCount = 0

  return {
    // ── Tiered: suffix hint on user message (cache-friendly, no system replace) ──
    "chat.message": async (input: any, output: any) => {
      const sessionId: string = input.sessionID ?? "default"
      const parts: any[] = output.parts || []
      const text = parts.filter((p: any) => p.type === "text").map((p: any) => p.text ?? "").join("\n").trim()
        || output.message?.summary?.title || ""
      const state = readState(ctx.directory)
      const currentState = state?.state ?? "DONE"
      const trivial = isTrivial(text, currentState)
      trivialBySession.set(sessionId, trivial)
      if (trivial) {
        // Preserve system[0] FULL cacheable, add suffix hint to user message
        const hint = "\n\n[PLUGIN HINT: Saludo trivial — responde breve sin tools. No hagas Discovery.]"
        if (output.parts && output.parts.length > 0) {
          const last = output.parts[output.parts.length - 1]
          if (last.type === "text") last.text = (last.text ?? "") + hint
          else output.parts.push({ type: "text", text: hint })
        } else if (output.message) {
          output.parts = [{ type: "text", text: text + hint }]
        }
      } else {
        // Also handle TIER1 hint for small tasks without replacing system
        // Intent detection for downgradeable 0/0+1 is done in record_discovery router, not here
      }
    },

    // ── Hard gates before any tool ──
    "tool.execute.before": async (input: any, _output: any) => {
      const tool: string = (input as any).tool as string
      const args: any = (input as any).args as any
      const sessionId: string = (input as any).sessionID ?? "default"

      // ── 0) Trivial greeting blocks for expensive tools (SKIP, not BLOCKED) ──
      const isTrivialSession = trivialBySession.get(sessionId) ?? false
      const stateForTrivial = readState(ctx.directory)
      if (isTrivialSession && stateForTrivial?.state === "DONE") {
        const blockedForTrivial = [
          "engram_mem_context", "mem_context",
          "codegraph_codegraph_explore", "codegraph_explore",
          "codegraph_codegraph_status", "codegraph_status",
        ]
        if (blockedForTrivial.some(t => tool.includes(t))) {
          throw new Error(`SKIP: trivial greeting, answer directly`)
        }
      }

      // ── 1) PENDING hard gate (0 tokens) ──
      checkCount++
      const freshState = readState(ctx.directory)
      const pendingStates = ["ROUTE_DECISION_PENDING", "EXECUTION_DECISION_PENDING", "CLARIFICATION_PENDING"]
      if (freshState && pendingStates.includes(freshState.state)) {
        // cache ALLOW per revision, BLOCKED never cached
        if (lastCheck && freshState.revision === lastCheck.revision && checkCount % 5 !== 0 && lastCheck.result === "ALLOW") {
          // reuse cached ALLOW
        } else {
          lastCheck = { revision: freshState.revision, result: pendingStates.includes(freshState.state) ? "BLOCKED" : "ALLOW" }
        }
        if (lastCheck.result === "BLOCKED") {
          const allowed = ["consume_route_decision", "consume_execution_decision", "record_clarification", "abandon", "check_file_access", "consume_file_access_decision", "record_user_confirmation"]
          const isControllerTool = tool.startsWith("ostacky-controller_") || tool.startsWith("ostacky_") || allowed.some(t => tool.includes(t))
          if (!isControllerTool) {
            throw new Error(`BLOCKED: call consume_* first — controller is in ${freshState.state}`)
          }
        }
      } else if (freshState) {
        lastCheck = { revision: freshState.revision, result: "ALLOW" }
      }

      // ── 1.5) Router determinista: openspec-propose bloquea si 1+ no-downgradeable sin Alternatives ──
      const isOpenspecPropose = tool.includes("openspec") && (tool.includes("propose") || args?.filePath?.includes("openspec/changes") || args?.path?.includes("openspec/changes"))
      if (isOpenspecPropose) {
        const s = readState(ctx.directory)
        if (s?.level === "1+" && s?._routerNeedsAlternatives) {
          // check if design.md has Alternatives
          try {
            const changeId = args?.changeId || s?.changeId || ""
            let designPath: string | null = null
            if (changeId) designPath = join(ctx.directory, "openspec", "changes", changeId, "design.md")
            else {
              // try to find any change dir with _routerNeedsAlternatives
              const changesDir = join(ctx.directory, "openspec", "changes")
              if (existsSync(changesDir)) {
                for (const entry of readdirSync(changesDir)) {
                  const p = join(changesDir, entry, "design.md")
                  if (existsSync(p)) { designPath = p; break }
                }
              }
            }
            if (designPath && existsSync(designPath)) {
              const design = readFileSync(designPath, "utf-8")
              if (!design.includes("## Alternatives")) {
                throw new Error(`BLOCKED: 1+ requiere brainstorming Alternatives en design.md antes de openspec-propose. Ejecuta skill(brainstorming) primero.`)
              }
            } else if (s?._routerNeedsAlternatives) {
              throw new Error(`BLOCKED: 1+ requiere brainstorming Alternatives en design.md antes de openspec-propose. Ejecuta skill(brainstorming) primero.`)
            }
          } catch (e: any) {
            if (e.message?.startsWith("BLOCKED")) throw e
          }
        }
      }

      // ── 2) CodeGraph preventivo: Read/Grep/Glob sobre código sin Discovery hit → BLOCKED ──
      const isCodeTool = tool === "read" || tool === "grep" || tool === "glob" || tool === "read_mcp_resource"
      if (isCodeTool) {
        let targetPath: string = args?.filePath || args?.path || args?.pattern || args?.include || args?.uri || ""
        if (tool === "grep" && args?.include) targetPath = args.include
        if (tool === "read_mcp_resource" && typeof args?.uri === "string") {
          const u = args.uri as string
          if (u.startsWith("file://")) targetPath = u.slice(7)
        }
        const isCodeFile = /\.(ts|js|tsx|jsx|mts|cts)$/i.test(targetPath) || targetPath.includes("src/") || targetPath.includes("assets/") || args?.pattern?.includes("*.ts")
        // Grep on *.md should not be blocked
        const isLiteralGrep = tool === "grep" && (args?.include?.endsWith(".md") || args?.include?.endsWith(".json"))
        if (isCodeFile && !isLiteralGrep) {
          const hasDiscoveryHit = discoveryHitByRequest.get(sessionId) ?? getDiscoveryCacheHit(ctx.directory)
          const codegraphOk = isCodegraphAvailable(ctx.directory)
          if (codegraphOk && !hasDiscoveryHit) {
            // Allow if file is not indexable or trivial?
            // Block with suggestion
            throw new Error(`BLOCKED: Usá getDiscoverySnapshot primero — sugerencia: getDiscoverySnapshot("${targetPath || "query"}")`)
          }
        }
      }

      // ── 3) Sensitive gate (hard, even in degraded) ──
      if (tool === "bash") {
        const cmd: string = args?.command || args?.cmd || ""
        if (typeof cmd === "string" && cmd) {
          const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "")
          const hasSensitivePattern = BASH_SENSITIVE_RE.test(normalized)
          const paths = extractPathsFromBash(cmd)
          const sensitivePaths = paths.filter((p) => isSensitive(p, patterns))
          if (hasSensitivePattern || sensitivePaths.length > 0) {
            if (sensitivePaths.length > 0) {
              for (const p of sensitivePaths) {
                const s = readState(ctx.directory)
                const candidates = [p, resolve(ctx.directory, p), join(ctx.directory, p)]
                const allowed = candidates.some((c) => s?.allowedFiles?.[c] || s?.allowedFiles?.[p])
                const baseAllowed = s?.allowedFiles?.[p] || s?.allowedFiles?.[basename(p)] || s?.allowedFiles?.[resolve(ctx.directory, p)]
                if (!allowed && !baseAllowed) {
                  const denied = s?.deniedFiles?.[p] || s?.deniedFiles?.[basename(p)]
                  if (denied) throw new Error(`BLOCKED: bash contiene acceso sensible (${p}) (previously denied) — Llamá check_file_access con reason antes.`)
                  throw new Error(`BLOCKED: bash contiene acceso sensible (${p}). Llamá check_file_access con reason antes.`)
                }
              }
            } else if (hasSensitivePattern) {
              const s = readState(ctx.directory)
              const hasAllowed = Object.keys(s?.allowedFiles || {}).some((k) => isSensitive(k, patterns))
              if (!hasAllowed) throw new Error(`BLOCKED: bash contiene acceso sensible (.env). Llamá check_file_access con reason antes.`)
            }
          }
        }
      }

      let filePath: string | undefined
      if (tool === "read" || tool === "read_mcp_resource" || tool === "grep" || tool === "glob" || tool === "write" || tool === "edit") {
        filePath = args?.filePath || args?.path || args?.pattern || args?.uri || ""
        if (tool === "grep" && args?.include) filePath = args.include
        if (tool === "write" || tool === "edit") filePath = args?.filePath || args?.path || ""
        if (tool === "read_mcp_resource" && typeof args?.uri === "string") {
          try {
            const u = args.uri as string
            if (u.startsWith("file://")) filePath = u.slice(7)
            else if (u.includes("/")) filePath = u
          } catch {}
        }
      }
      if (filePath && isSensitive(filePath, patterns)) {
        const s = readState(ctx.directory)
        const allowed = s?.allowedFiles?.[filePath] || s?.allowedFiles?.[resolve(ctx.directory, filePath)] || s?.allowedFiles?.[basename(filePath)]
        if (!allowed) {
          const denied = s?.deniedFiles?.[filePath] || s?.deniedFiles?.[basename(filePath)]
          if (denied) throw new Error(`BLOCKED: File ${filePath} requires check_file_access (previously denied)`)
          throw new Error(`BLOCKED: File ${filePath} requires check_file_access`)
        }
      }

      // ── 4) validate_edit in-process for write/edit ──
      if (tool === "write" || tool === "edit") {
        const oldString: string = args?.oldString ?? ""
        const newString: string = args?.newString ?? args?.content ?? ""
        const targetPath: string = args?.filePath || args?.path || ""
        if (targetPath && typeof oldString === "string" && typeof newString === "string") {
          if (oldString === newString) {
            throw new Error(`CONFLICT: oldString === newString`)
          }
          if (!isPathInsideProject(targetPath, ctx.directory)) {
            throw new Error(`BLOCKED: path outside project: ${targetPath}`)
          }
          // If oldString is hash:<fp> handle stale check
          if (oldString.startsWith("hash:")) {
            const claimed = oldString.slice(5)
            const currentFp = fastFingerprint(resolve(ctx.directory, targetPath))
            const s = readState(ctx.directory)
            const last = s?.lastValidated
            if (claimed !== currentFp || (last && last.filePath === targetPath && last.hash !== currentFp)) {
              // mark stale attempt
              try {
                const st = readState(ctx.directory) || { ...DEFAULT_STATE }
                st.staleContentAttempts = (st.staleContentAttempts || 0) + 1
                persistState(ctx.directory, st)
              } catch {}
              throw new Error(`CONFLICT: stale fingerprint for ${targetPath}`)
            }
          } else if (oldString.length > 0) {
            // Check fresh content has exactly one occurrence
            try {
              const fullPath = resolve(ctx.directory, targetPath)
              if (existsSync(fullPath)) {
                const content = readFileSync(fullPath, "utf-8")
                const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                // count occurrences literally, not regex
                let count = 0
                let idx = 0
                while ((idx = content.indexOf(oldString, idx)) !== -1) {
                  count++
                  idx += oldString.length
                  if (count > 1) break
                }
                if (count === 0) throw new Error(`CONFLICT: oldString not found in ${targetPath}`)
                if (count > 1) throw new Error(`CONFLICT: oldString appears ${count} times in ${targetPath} (must be exactly 1)`)
              }
            } catch (e: any) {
              if (e.message?.startsWith("CONFLICT")) throw e
              // file not exists -> allow write?
            }
          }
          // Record lastValidated for future hash checks
          try {
            const st = readState(ctx.directory)
            if (st) {
              const fp = fastFingerprint(resolve(ctx.directory, targetPath))
              st.lastValidated = { filePath: targetPath, hash: fp, ts: Date.now() }
            }
          } catch {}
        }
      }
    },

    "tool.execute.after": async (input: any, output: any) => {
      // Track discovery hit to allow subsequent Reads
      const tool: string = (input as any).tool as string
      const sessionId: string = (input as any).sessionID ?? "default"
      if (tool.includes("getDiscoverySnapshot") || tool.includes("get_discovery_snapshot")) {
        // if output indicates hit, mark it
        try {
          const text = typeof output === "string" ? output : JSON.stringify(output)
          if (text && !text.includes("null") && text.length > 10) {
            discoveryHitByRequest.set(sessionId, true)
          }
        } catch {}
      }
      // Update state metrics for cache hit (best-effort)
      if (tool.includes("getDiscoverySnapshot") && output) {
        try {
          const s = readState((input as any).ctx?.directory ?? "")
        } catch {}
      }
    },

    // ── Observable tools (MCP thin replacement) ──
    tool: {
      ostacky_get_state: {
        description: "Get Ostacky controller state (plugin, no MCP needed)",
        parameters: {} as any,
        execute: async (_args: any, ctx2: any) => {
          const dir = ctx2?.directory ?? ctx.directory
          const state = readState(dir)
          if (!state) return { error: "no state", state: "UNKNOWN", revision: 0 }
          return { state: state.state, revision: state.revision, requestId: state.requestId, degraded: !!state.degraded, level: state.level, routeChoice: state.routeChoice }
        },
      },
      ostacky_get_audit: {
        description: "Get audit trail (plugin)",
        parameters: {} as any,
        execute: async (_args: any, ctx2: any) => {
          const dir = ctx2?.directory ?? ctx.directory
          const state = readState(dir)
          return { audit: state?.audit ?? [], revision: state?.revision ?? 0 }
        },
      },
      ostacky_get_metrics: {
        description: "Get controller metrics (plugin)",
        parameters: {} as any,
        execute: async (_args: any, ctx2: any) => {
          const dir = ctx2?.directory ?? ctx.directory
          const state = readState(dir)
          return {
            cacheHitCount: state?.cacheHitCount ?? 0,
            discoveryCacheHitCount: state?.discoveryCacheHitCount ?? 0,
            tokenSavingEstimate: state?.tokenSavingEstimate ?? 0,
            stateCheckCount: state?.stateCheckCount ?? 0,
            codegraphBypassCount: state?.codegraphBypassCount ?? 0,
            revision: state?.revision ?? 0,
          }
        },
      },
      ostacky_get_handoff: {
        description: "Get last handoff (plugin)",
        parameters: {} as any,
        execute: async (_args: any, ctx2: any) => {
          const dir = ctx2?.directory ?? ctx.directory
          const state = readState(dir)
          // also check compaction fallback
          try {
            const fallback = join(dirname(getStatePath(dir)), ".ostacky-handoff-compaction.json")
            if (existsSync(fallback)) {
              const raw = readFileSync(fallback, "utf-8")
              const data = JSON.parse(raw)
              if (data && !state?.lastHandoff) return data
            }
          } catch {}
          return state?.lastHandoff ?? null
        },
      },
      ostacky_get_available_transitions: {
        description: "Get available transitions from current state",
        parameters: {} as any,
        execute: async (_args: any, ctx2: any) => {
          const dir = ctx2?.directory ?? ctx.directory
          const state = readState(dir)
          const cur = state?.state ?? "INTERPRETATION_PENDING"
          const trans = TRANSITIONS[cur] ?? []
          return { currentState: cur, transitions: trans }
        },
      },
      // Compatibility for old MCP calls that expect deprecated response
      ostacky_check_pending_state: {
        description: "[deprecated] plugin enforces — use tool before hook",
        parameters: {} as any,
        execute: async (_args: any) => {
          return { deprecated: true, hint: "plugin enforces", allowed: true }
        },
      },
      ostacky_validate_edit: {
        description: "[deprecated] plugin enforces validate_edit in-process",
        parameters: {} as any,
        execute: async (_args: any) => {
          return { deprecated: true, hint: "plugin enforces" }
        },
      },
    },

    event: async ({ event }: any) => {
      if (event.type === "session.deleted") {
        const sid = (event.properties as any)?.info?.id
        if (sid) {
          trivialBySession.delete(sid)
          discoveryHitByRequest.delete(sid)
        }
      }
    },

    "experimental.session.compacting": async (input: any, output: any) => {
      try {
        const statePath = getStatePath(ctx.directory)
        const dir = dirname(statePath)
        try { mkdirSync(dir, { recursive: true }) } catch {}
        const fallbackPath = join(dir, ".ostacky-handoff-compaction.json")
        const payload = {
          summary: `Compaction fallback for session ${input.sessionID ?? "unknown"} — plugin`,
          nextSteps: [] as string[],
          pendingTasks: [] as string[],
          ts: Date.now(),
          contextSnippet: output.context?.slice(0, 2).join("\n\n").slice(0, 800) ?? "",
        }
        const tmp = `${fallbackPath}.tmp.${process.pid}`
        writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8")
        renameSync(tmp, fallbackPath)
      } catch {}
    },
  }
}

export default OstackyController
