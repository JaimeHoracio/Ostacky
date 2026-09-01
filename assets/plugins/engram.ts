/**
 * Engram — OpenCode plugin adapter
 *
 * Thin layer that connects OpenCode's event system to the Engram Go binary.
 * The Go binary runs as a local HTTP server and handles all persistence.
 *
 * Flow:
 *   OpenCode events → this plugin → HTTP calls → engram serve → SQLite
 *
 * Session resilience:
 *   Uses `ensureSession()` before any DB write. This means sessions are
 *   created on-demand — even if the plugin was loaded after the session
 *   started (restart, reconnect, etc.). The session ID comes from OpenCode's
 *   hooks (input.sessionID) rather than relying on a session.created event.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { join, dirname, basename } from "path"
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs"

// ─── Configuration ───────────────────────────────────────────────────────────

const ENGRAM_PORT = parseInt(process.env.ENGRAM_PORT ?? "7437")
const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`
// C3/H2 fix: resolve ENGRAM_BIN per ctx.directory with win32 .exe and absolute fallback
function resolveEngramBin(directory: string): string {
  if (process.env.ENGRAM_BIN) {
    const p = process.env.ENGRAM_BIN
    const isAbs = p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
    return isAbs ? p : join(directory, p)
  }
  const which = Bun.which("engram")
  if (which) return which
  const suffix = process.platform === "win32" ? ".exe" : ""
  return join(directory, ".opencode", "tools", "engram", "bin", `engram${suffix}`)
}
// ENGRAM_BIN eliminado: reemplazado por resolveEngramBin(ctx.directory) que maneja .exe+absolutización correctamente

// Engram's own MCP tools — don't count these as "tool calls" for session stats
const ENGRAM_TOOLS = new Set([
  "mem_search",
  "mem_save",
  "mem_update",
  "mem_delete",
  "mem_suggest_topic_key",
  "mem_save_prompt",
  "mem_session_summary",
  "mem_context",
  "mem_stats",
  "mem_timeline",
  "mem_get_observation",
  "mem_session_start",
  "mem_session_end",
])

// ─── Memory Instructions ─────────────────────────────────────────────────────
// Lazy: full protocol lives in assets/docs/engram-protocol.md (on-demand via Read).
// System injects only pointer + nudge, not full 1.2k. Source-of-truth: src/tiered.ts for isTrivial.

const MEMORY_POINTER = "Engram disponible — para formato mem_save/mem_search lee assets/docs/engram-protocol.md (on-demand). Usa mem_search proactivamente si el tema pudo verse antes."
const MEMORY_INSTRUCTIONS_LAZY = `## Engram — pointer (lazy)

${MEMORY_POINTER}

Cuando necesites guardar/buscar, lee el protocolo completo con Read. No alucines formato.`
// Compat: keep full for fallback if file missing — but never inject full in system.transform
const MEMORY_INSTRUCTIONS = MEMORY_INSTRUCTIONS_LAZY

// ─── HTTP Client ─────────────────────────────────────────────────────────────

async function engramFetch(
  path: string,
  opts: { method?: string; body?: any } = {}
): Promise<any> {
  try {
    const res = await fetch(`${ENGRAM_URL}${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    return await res.json()
  } catch {
    // Engram server not running — silently fail
    return null
  }
}

async function isEngramRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${ENGRAM_URL}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractProjectName(directory: string): string {
  // Try git remote origin URL
  try {
    const result = Bun.spawnSync(["git", "-C", directory, "remote", "get-url", "origin"])
    if (result.exitCode === 0) {
      const url = result.stdout?.toString().trim()
      if (url) {
        const name = url.replace(/\.git$/, "").split(/[/:]/).pop()
        if (name) return name
      }
    }
  } catch {}

  // Fallback: git root directory name (works in worktrees)
  try {
    const result = Bun.spawnSync(["git", "-C", directory, "rev-parse", "--show-toplevel"])
    if (result.exitCode === 0) {
      const root = result.stdout?.toString().trim()
      if (root) return basename(root.replace(/\\/g, "/")) ?? "unknown"
    }
  } catch {}

  // Final fallback: cwd basename (cross-platform)
  return basename(directory.replace(/\\/g, "/")) ?? "unknown"
}

function truncate(str: string, max: number): string {
  if (!str) return ""
  return str.length > max ? str.slice(0, max) + "..." : str
}

/**
 * Strip <private>...</private> tags before sending to engram.
 * Double safety: the Go binary also strips, but we strip here too
 * so sensitive data never even hits the wire.
 */
function stripPrivateTags(str: string): string {
  if (!str) return ""
  return str.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]").trim()
}

function stripJsoncComments(text: string): string {
  let result = ""
  let i = 0
  let inString = false
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      if (char === "\\") {
        result += char + (next ?? "")
        i += 2
        continue
      }
      if (char === '"') inString = false
      result += char
      i++
      continue
    }
    if (char === '"') {
      inString = true
      result += char
      i++
      continue
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (char === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    result += char
    i++
  }
  return result.replace(/,\s*([}\]])/g, "$1")
}

// ─── Plugin Export ───────────────────────────────────────────────────────────

export const Engram: Plugin = async (ctx) => {
  // T4: basename multiplataforma — split("/") producía keys basura con backslashes en Windows nativo
  const oldProject = basename(ctx.directory.replace(/\\/g, "/")) ?? "unknown"
  const project = extractProjectName(ctx.directory)

  // Track tool counts per session (in-memory only, not critical)
  const toolCounts = new Map<string, number>()

  // Track last nudge time per session to debounce save reminders
  const lastNudgeTime = new Map<string, number>() // sessionID -> epoch seconds

  // Track which sessions we've already ensured exist in engram
  const knownSessions = new Set<string>()

  // Track sub-agent session IDs so we can suppress their tool-hook registrations.
  // Sub-agents (Task() calls) have a parentID or a title ending in " subagent)".
  // We must not register them as top-level Engram sessions — they cause session
  // inflation (e.g. 170 sessions for 1 real conversation, issue #116).
  const subAgentSessions = new Set<string>()

  // Tiered cache-friendly: single source of truth via src/tiered.ts
  const trivialBySession = new Map<string, boolean>()
  // isTrivial y getControllerState importados lógicamente desde src/tiered.ts
  // Inlined para evitar import dinámico en plugin bundle — mantener regex idéntico a src/tiered.ts
  function isTrivialMessage(msg: string, state: string): boolean {
    if (!msg || state !== "DONE") return false
    if (msg.trim().length >= 30) return false
    if (!/^(hola|hey|gracias|buenas|hi|hello)\b/i.test(msg.trim())) return false
    if (/(necesito|quiero|agregá|fix|bug|feature|auth|spec|implementar)/i.test(msg)) return false
    return true
  }
  function getControllerState(directory: string): string {
    try {
      const statePath = process.env.OSTACKY_STATE_PATH || join(directory, ".opencode", "ostacky-state.json")
      const raw = readFileSync(statePath, "utf-8")
      const j = JSON.parse(raw)
      return j.state ?? "DONE"
    } catch { return "DONE" }
  }

  /**
   * Ensure a session exists in engram. Idempotent — calls POST /sessions
   * which uses INSERT OR IGNORE. Safe to call multiple times.
   *
   * Silently skips sub-agent sessions (tracked in `subAgentSessions`).
   */
  async function ensureSession(sessionId: string): Promise<void> {
    if (!sessionId || knownSessions.has(sessionId)) return
    // Do not register sub-agent sessions in Engram (issue #116).
    if (subAgentSessions.has(sessionId)) return
    knownSessions.add(sessionId)
    await engramFetch("/sessions", {
      method: "POST",
      body: {
        id: sessionId,
        project,
        directory: ctx.directory,
      },
    })
  }

  // Try to start engram server if not running — use per-directory resolved bin (win32 .exe + absolute)
  const engramBin = resolveEngramBin(ctx.directory)
  const running = await isEngramRunning()
  if (!running) {
    try {
      Bun.spawn([engramBin, "serve"], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      })
      await new Promise((r) => setTimeout(r, 500))
    } catch {
      // Binary not found or can't start — plugin will silently no-op
    }
  }

  // Migrate project name if it changed (one-time, idempotent)
  // Must run AFTER server startup to ensure the endpoint is available
  if (oldProject !== project) {
    await engramFetch("/projects/migrate", {
      method: "POST",
      body: { old_project: oldProject, new_project: project },
    })
  }

  // Auto-import: if .engram/manifest.json exists in the project repo,
  // run `engram sync --import` to load any new chunks into the local DB.
  // This is how git-synced memories get loaded when cloning a repo or
  // pulling changes. Each chunk is imported only once (tracked by ID).
  try {
    const manifestFile = `${ctx.directory}/.engram/manifest.json`
    const file = Bun.file(manifestFile)
    if (await file.exists()) {
      Bun.spawn([engramBin, "sync", "--import"], {
        cwd: ctx.directory,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      })
    }
  } catch {
    // Manifest doesn't exist or binary not found — silently skip
  }

  return {
    // ─── Event Listeners ───────────────────────────────────────────

    event: async ({ event }) => {
      // --- Session Created ---
      if (event.type === "session.created") {
        // Bug fix (#116): session data is nested under event.properties.info,
        // not event.properties directly.
        const info = (event.properties as any)?.info
        const sessionId = info?.id
        const parentID = info?.parentID
        const title: string = info?.title ?? ""

        // Sub-agent sessions (created via Task()) must NOT be registered as
        // top-level Engram sessions. They cause massive session inflation
        // (e.g. 170 sessions for 1 real conversation).
        //
        // Detection heuristics:
        //   - parentID is set on all Task() sub-agent sessions
        //   - title ends with " subagent)" as a secondary signal
        const isSubAgent = !!parentID || title.endsWith(" subagent)")

        if (sessionId && !isSubAgent) {
          await ensureSession(sessionId)
        } else if (sessionId && isSubAgent) {
          // Remember this as a sub-agent session so tool-hook calls
          // to ensureSession() are also suppressed for it.
          subAgentSessions.add(sessionId)
        }
      }

      // --- Session Deleted ---
      if (event.type === "session.deleted") {
        // Same properties.info path as session.created.
        const info = (event.properties as any)?.info
        const sessionId = info?.id
        if (sessionId) {
          toolCounts.delete(sessionId)
          knownSessions.delete(sessionId)
          subAgentSessions.delete(sessionId)
          lastNudgeTime.delete(sessionId)
        }
      }

    },

    // ─── User Prompt Capture ──────────────────────────────────────
    // chat.message is called once per user message, before the LLM sees it.
    // input.sessionID is always reliable here (no knownSessions workaround).
    // output.message is typed as UserMessage (role:"user" already guaranteed).
    // output.parts contains TextPart[] with the actual message text.

    "chat.message": async (input, output) => {
      // Skip sub-agent sessions — they inflate session counts (issue #116)
      if (subAgentSessions.has(input.sessionID)) return

      const sessionId = input.sessionID

      // Extract text from parts (type:"text")
      const content = output.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).text ?? "")
        .join("\n")
        .trim()

      // Also fallback to summary if parts yield nothing
      const fallback = !content && output.message.summary
        ? `${output.message.summary.title ?? ""}\n${output.message.summary.body ?? ""}`.trim()
        : ""

      const finalContent = content || fallback

      // Tiered: set trivial flag for system.transform lazy
      try {
        const state = getControllerState(ctx.directory)
        trivialBySession.set(sessionId, isTrivialMessage(finalContent, state))
      } catch {}

      // Only capture non-trivial prompts (>10 chars)
      if (finalContent.length > 10) {
        await ensureSession(sessionId)
        await engramFetch("/prompts", {
          method: "POST",
          body: {
            session_id: sessionId,
            content: stripPrivateTags(truncate(finalContent, 2000)),
            project,
          },
        })
      }
    },

    // ─── Tool Execution Hook ─────────────────────────────────────
    // Count tool calls per session (for session end stats).
    // Also ensures the session exists — handles plugin reload / reconnect.
    // Passive capture: when a Task tool completes, POST its output to
    // the passive capture endpoint so the server extracts learnings.

    "tool.execute.after": async (input, output) => {
      if (ENGRAM_TOOLS.has(input.tool.toLowerCase())) return

      // input.sessionID comes from OpenCode — always available
      const sessionId = input.sessionID
      if (sessionId) {
        await ensureSession(sessionId)
        toolCounts.set(sessionId, (toolCounts.get(sessionId) ?? 0) + 1)
      }

      // Passive capture: extract learnings from Task tool output
      if (input.tool === "Task" && output && sessionId) {
        const text = typeof output === "string" ? output : JSON.stringify(output)
        if (text.length > 50) {
          await engramFetch("/observations/passive", {
            method: "POST",
            body: {
              session_id: sessionId,
              content: stripPrivateTags(text),
              project,
              source: "task-complete",
            },
          })
        }
      }
    },

    // ─── System Prompt: Always-on memory instructions ──────────
    // Injects MEMORY_INSTRUCTIONS into the system prompt of every message.
    // This ensures the agent ALWAYS knows about Engram, even after compaction.
    //
    // We append to the last existing system entry instead of pushing a new one.
    // Some models (Qwen3.5, Mistral/Ministral via llama.cpp) reject multiple
    // system messages — their Jinja chat templates only allow a single system
    // block at the beginning. By concatenating, we avoid adding extra system
    // messages that would break these models. See: GitHub issue #23.

    "experimental.chat.system.transform": async (input, output) => {
      // Tiered lazy: SIEMPRE pointer (cache-friendly, ~1 línea). Full vive en assets/docs/engram-protocol.md on-demand.
      const sessionId: string = (input as any).sessionID ?? ""
      const isTrivial = trivialBySession.get(sessionId) ?? false
      const state = getControllerState(ctx.directory)
      const shouldBeTrivial = isTrivial && state === "DONE"
      const pointer = shouldBeTrivial
        ? "Engram disponible — detalles a demanda (usa mem_search si necesitas recordar)."
        : MEMORY_POINTER
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += "\n\n" + pointer
      } else {
        output.system.push(pointer)
      }
      // No inyectar MEMORY_INSTRUCTIONS completo nunca — se lee on-demand via Read

      // ── Save nudge ──────────────────────────────────────────────────────────
      // Skip nudge for trivial greeting (cache-friendly, no extra injection)
      if (shouldBeTrivial) return
      // If it has been a long time since the last mem_save, append a reminder
      // to the system prompt so the agent notices. All fetches are fire-and-
      // forget with short timeouts — any failure silently skips the nudge.
      try {
        const sessionID: string = input.sessionID ?? ""
        if (!sessionID || subAgentSessions.has(sessionID)) return

        // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC with no
        // zone suffix; new Date() would parse that as local time. Normalize to
        // UTC first so the thresholds are correct in every timezone.
        const toEpochSecs = (ts: string): number => {
          if (!ts) return 0
          const normalized = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z"
          const ms = new Date(normalized).getTime()
          return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
        }

        const cooldownSecs = parseInt(process.env.ENGRAM_NUDGE_COOLDOWN_SECS ?? "900", 10)
        const nowSecs = Math.floor(Date.now() / 1000)

        // Debounce: skip if we nudged recently this session
        const lastNudge = lastNudgeTime.get(sessionID)
        if (lastNudge !== undefined && nowSecs - lastNudge < cooldownSecs) return

        // Skip if the session is too young (< 5 minutes)
        let sessionStartEpoch = 0
        try {
          const sessionRes = await fetch(`${ENGRAM_URL}/sessions/${encodeURIComponent(sessionID)}`, {
            signal: AbortSignal.timeout(200),
          })
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json()
            const startedAt: string = sessionData?.started_at ?? ""
            if (startedAt) {
              sessionStartEpoch = toEpochSecs(startedAt)
            }
          }
        } catch {
          // Server unreachable or timed out — skip nudge
          return
        }
        if (sessionStartEpoch > 0 && nowSecs - sessionStartEpoch < 300) return

        // Check when the last observation was saved for this project
        let lastObsEpoch = 0
        try {
          const obsRes = await fetch(
            `${ENGRAM_URL}/observations?project=${encodeURIComponent(project)}&limit=1&sort=created_at:desc`,
            { signal: AbortSignal.timeout(200) }
          )
          if (obsRes.ok) {
            const obsData = await obsRes.json()
            const createdAt: string = obsData?.[0]?.created_at ?? ""
            if (createdAt) {
              lastObsEpoch = toEpochSecs(createdAt)
            }
          }
        } catch {
          // Server unreachable or timed out — skip nudge
          return
        }

        // No observations yet — nothing to nudge about
        if (lastObsEpoch === 0) return

        // Only nudge if last save was more than 15 minutes ago
        if (nowSecs - lastObsEpoch < 900) return

        // Append the nudge to the last system message
        const nudge =
          "\n\nMEMORY REMINDER: It's been over 15 minutes since your last memory save. " +
          "If you've made decisions, discoveries, completed significant work, or found non-obvious things, " +
          "call mem_save now."
        if (output.system.length > 0) {
          output.system[output.system.length - 1] += nudge
        } else {
          output.system.push(nudge)
        }
        lastNudgeTime.set(sessionID, nowSecs)
      } catch {
        // Any unexpected error — silently skip the nudge, never crash the hook
      }
    },

    // ─── Compaction Hook: Persist memory + inject context ──────────
    // Compaction is triggered by the system (not the agent) when context
    // gets too long. The old agent "dies" and a new one starts with the
    // compacted summary. This is our chance to:
    // 1. Auto-save a session checkpoint (the agent can't do this itself)
    // 2. Inject context from previous sessions into the compaction prompt
    // 3. Tell the compressor to remind the new agent to save memories

    "experimental.session.compacting": async (input, output) => {
      if (input.sessionID) {
        await ensureSession(input.sessionID)
      }

      // C3: Compaction fallback file — write directly to same anchor as controller's get_handoff
      // Resolves statePath from opencode.json (local) or global config, default .opencode/ostacky-state.json
      try {
        let statePath: string | null = null
        // 1) env var if set
        if (process.env.OSTACKY_STATE_PATH) {
          statePath = process.env.OSTACKY_STATE_PATH
        }
        // 2) try local opencode.json / jsonc in project
        if (!statePath) {
          const candidates = [join(ctx.directory, "opencode.json"), join(ctx.directory, "opencode.jsonc")]
          // also try global config (XDG / APPDATA)
          try {
            const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
            if (home) {
              const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config")
              candidates.push(join(xdg, "opencode", "opencode.json"))
              candidates.push(join(xdg, "opencode", "opencode.jsonc"))
              if (process.platform === "win32" && process.env.APPDATA) {
                candidates.push(join(process.env.APPDATA, "opencode", "opencode.json"))
                candidates.push(join(process.env.APPDATA, "opencode", "opencode.jsonc"))
              }
            }
          } catch {}
          for (const cand of candidates) {
            try {
              const raw = readFileSync(cand, "utf-8")
              const j = stripJsoncComments(raw)
              const cfg = JSON.parse(j)
              const envPath = (cfg as any)?.mcp?.["ostacky-controller"]?.environment?.OSTACKY_STATE_PATH
              if (typeof envPath === "string" && envPath) {
                statePath = envPath
                break
              }
            } catch {}
          }
        }
        if (!statePath) statePath = join(ctx.directory, ".opencode", "ostacky-state.json")
        const fallbackPath = join(dirname(statePath), ".ostacky-handoff-compaction.json")
        try { mkdirSync(dirname(fallbackPath), { recursive: true }) } catch {}
        const payload = {
          summary: `Compaction fallback for session ${input.sessionID ?? "unknown"} — project ${project}`,
          nextSteps: [] as string[],
          pendingTasks: [] as string[],
          ts: Date.now(),
          contextSnippet: output.context?.slice(0, 2).join("\n\n").slice(0, 1000) ?? "",
        }
        const tmp = `${fallbackPath}.tmp.${process.pid}`
        writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8")
        renameSync(tmp, fallbackPath)
      } catch {
        // fallback is best-effort — never crash compacting
      }

      // Inject context from previous sessions
      const data = await engramFetch(
        `/context?project=${encodeURIComponent(project)}`
      )
      if (data?.context) {
        output.context.push(data.context)
      }

      // Tell the compressor to instruct the new agent to persist the
      // compacted summary to Engram. The new agent reads the compacted
      // summary and this instruction, then saves it as a session summary.
      output.context.push(
        `CRITICAL INSTRUCTION FOR COMPACTED SUMMARY:\n` +
        `The agent has access to Engram persistent memory via MCP tools.\n` +
        `You MUST include the following instruction at the TOP of the compacted summary:\n\n` +
        `"FIRST ACTION REQUIRED: Call mem_session_summary with the content of this compacted summary. ` +
        `Use project: '${project}'. This preserves what was accomplished before compaction. Do this BEFORE any other work."\n\n` +
        `This is NOT optional. Without this, everything done before compaction is lost from memory.`
      )
    },
  }
}
