/**
 * Engram — OpenCode plugin adapter (OpenCode V2)
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
 *   hooks (event.sessionID) rather than relying on a session.created event.
 */

// NOTA: sin `import { Plugin }` runtime a propósito — el server V2 no resuelve
// `@opencode/plugin` desde `.opencode/plugins/` y `Plugin.define()` es
// passthrough ({id, setup}). `import type` se borra al transpilar.
import type { Plugin } from "@opencode/plugin"
import { join, dirname, basename, delimiter } from "node:path"
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"

// ─── Configuration ───────────────────────────────────────────────────────────

const ENGRAM_PORT = parseInt(process.env.ENGRAM_PORT ?? "7437")
const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`
// C3/H2 fix: resolve ENGRAM_BIN per directory with win32 .exe and absolute fallback
function lookupOnPath(name: string): string | null {
  try {
    const pathEnv = process.env.PATH ?? ""
    const suffix = process.platform === "win32" ? ".exe" : ""
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue
      try {
        const cand = join(dir, name + suffix)
        if (existsSync(cand)) return cand
        if (suffix && existsSync(join(dir, name))) return join(dir, name)
      } catch {}
    }
  } catch {}
  return null
}
function resolveEngramBin(directory: string): string {
  if (process.env.ENGRAM_BIN) {
    const p = process.env.ENGRAM_BIN
    const isAbs = p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
    return isAbs ? p : join(directory, p)
  }
  const which = lookupOnPath("engram")
  if (which) return which
  const suffix = process.platform === "win32" ? ".exe" : ""
  return join(directory, ".opencode", "tools", "engram", "bin", `engram${suffix}`)
}
// ENGRAM_BIN eliminado: reemplazado por resolveEngramBin(directory) que maneja .exe+absolutización correctamente

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
    const result = spawnSync("git", ["-C", directory, "remote", "get-url", "origin"], { encoding: "utf-8" })
    if (result.status === 0) {
      const url = (result.stdout ?? "").trim()
      if (url) {
        const name = url.replace(/\.git$/, "").split(/[/:]/).pop()
        if (name) return name
      }
    }
  } catch {}

  // Fallback: git root directory name (works in worktrees)
  try {
    const result = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], { encoding: "utf-8" })
    if (result.status === 0) {
      const root = (result.stdout ?? "").trim()
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

// ─── Plugin ──────────────────────────────────────────────────────────────────

// Objeto literal directo (ver nota en imports).
export default {
  id: "engram",
  async setup(ctx) {
    const directory = ctx.location.directory
    // T4: basename multiplataforma — split("/") producía keys basura con backslashes en Windows nativo
    const oldProject = basename(directory.replace(/\\/g, "/")) ?? "unknown"
    const project = extractProjectName(directory)

    // Track tool counts per session (in-memory only, not critical)
    const toolCounts = new Map<string, number>()

    // Track last nudge time per session to debounce save reminders
    const lastNudgeTime = new Map<string, number>() // sessionID -> epoch seconds

    // Track which sessions we've already ensured exist in engram
    const knownSessions = new Set<string>()

    // Track sub-agent session IDs so we can suppress their tool-hook registrations.
    // Sub-agents (subagent tool calls) have a parentID or a title ending in " subagent)".
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
    function getControllerState(dir: string): string {
      try {
        const statePath = process.env.OSTACKY_STATE_PATH || join(dir, ".opencode", "ostacky-state.json")
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
          directory,
        },
      })
    }

    // Try to start engram server if not running — use per-directory resolved bin (win32 .exe + absolute)
    const engramBin = resolveEngramBin(directory)
    const running = await isEngramRunning()
    if (!running) {
      try {
        const child = spawn(engramBin, ["serve"], {
          detached: true,
          stdio: "ignore",
          cwd: directory,
        })
        child.unref()
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
      const manifestFile = join(directory, ".engram", "manifest.json")
      if (existsSync(manifestFile)) {
        const child = spawn(engramBin, ["sync", "--import"], {
          detached: true,
          stdio: "ignore",
          cwd: directory,
        })
        child.unref()
      }
    } catch {
      // Manifest doesn't exist or binary not found — silently skip
    }

    // ─── Event subscription (session lifecycle) ──────────────────────
    const eventController = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: eventController.signal })) {
        // --- Session Created ---
        if (event.type === "session.created") {
          // V2: session data is flat under event.data (id/parentID/title),
          // not nested under properties.info like V1.
          const data = event.data as { sessionID?: string; parentID?: string | null; title?: string }
          const sessionId = data?.sessionID
          const parentID = data?.parentID
          const title: string = data?.title ?? ""

          // Sub-agent sessions (created via subagent tool) must NOT be registered as
          // top-level Engram sessions. They cause massive session inflation
          // (e.g. 170 sessions for 1 real conversation).
          //
          // Detection heuristics:
          //   - parentID is set on all sub-agent sessions
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
          // V2: event.data.sessionID (flat), not properties.info.id.
          const sessionId = (event.data as { sessionID?: string })?.sessionID
          if (sessionId) {
            toolCounts.delete(sessionId)
            knownSessions.delete(sessionId)
            subAgentSessions.delete(sessionId)
            lastNudgeTime.delete(sessionId)
          }
        }
      }
    })()

    // ─── User Prompt Capture ──────────────────────────────────────
    // session prompt hook runs once per user message at admission, before the LLM sees it.
    // event.sessionID is always reliable here. event.prompt.text holds the message text.

    await ctx.session.hook("prompt", async (event) => {
      // Skip sub-agent sessions — they inflate session counts (issue #116)
      if (subAgentSessions.has(event.sessionID)) return

      const sessionId = event.sessionID

      // Prompt text is the source (V2 prompt admission carries the full text)
      const finalContent = (event.prompt.text ?? "").trim()

      // Tiered: set trivial flag for context-hook pointer selection
      try {
        const state = getControllerState(directory)
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
    })

    // ─── Tool Execution Hook ─────────────────────────────────────
    // Count tool calls per session (for session end stats).
    // Also ensures the session exists — handles plugin reload / reconnect.
    // Passive capture: when a subagent tool completes, POST its output to
    // the passive capture endpoint so the server extracts learnings.

    await ctx.tool.hook("execute.after", async (event) => {
      if (ENGRAM_TOOLS.has(event.tool.toLowerCase())) return

      // event.sessionID comes from OpenCode — always available
      const sessionId = event.sessionID
      if (sessionId) {
        await ensureSession(sessionId)
        toolCounts.set(sessionId, (toolCounts.get(sessionId) ?? 0) + 1)
      }

      // Passive capture: extract learnings from subagent tool output
      // (V2 tool name is "subagent"; V1 "Task" no longer exists — see v2/docs/tools)
      if (event.tool === "subagent" && event.status === "completed" && event.result && sessionId) {
        const text = JSON.stringify(event.result)
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
    })

    // ─── System Pointer: Always-on memory instructions ──────────
    // Injects the lazy pointer into model-visible context before each agent request.
    // This ensures the agent ALWAYS knows about Engram, even after compaction.
    //
    // We append to system (not a new message) so prompt caching stays stable.
    // Tiered lazy: SIEMPRE pointer (cache-friendly, ~1 línea). Full vive en assets/docs/engram-protocol.md on-demand.

    await ctx.session.hook("context", async (event) => {
      const sessionId: string = event.sessionID ?? ""
      const isTrivial = trivialBySession.get(sessionId) ?? false
      const state = getControllerState(directory)
      const shouldBeTrivial = isTrivial && state === "DONE"
      const pointer = shouldBeTrivial
        ? "Engram disponible — detalles a demanda (usa mem_search si necesitas recordar)."
        : MEMORY_POINTER
      event.system.push({ type: "text", text: pointer })
      // No inyectar MEMORY_INSTRUCTIONS completo nunca — se lee on-demand via Read

      // harden-compaction-resume: auto-inject recovery hint when pending (no depende del modelo)
      if (!shouldBeTrivial) {
        try {
          const statePath = process.env.OSTACKY_STATE_PATH || join(directory, ".opencode", "ostacky-state.json")
          const raw = readFileSync(statePath, "utf-8")
          const st = JSON.parse(raw)
          const curState = st?.state ?? "DONE"
          if (!["DONE", "INTERPRETATION_PENDING"].includes(curState)) {
            let pending: string[] = Array.isArray(st?.lastHandoff?.pendingTasks)
              ? st.lastHandoff.pendingTasks.filter((id: string) => !st.tasks?.[id] || st.tasks[id].status !== "COMPLETED")
              : []
            if (pending.length === 0) {
              try {
                const fbPath = join(dirname(statePath), ".ostacky-handoff-compaction.json")
                const fbRaw = readFileSync(fbPath, "utf-8")
                const fb = JSON.parse(fbRaw)
                if (fb && Array.isArray(fb.pendingTasks) && typeof fb.ts === "number" && Date.now() - fb.ts < 24 * 60 * 60 * 1000) {
                  const fbPend = fb.pendingTasks.filter((id: string) => !st.tasks?.[id] || st.tasks[id].status !== "COMPLETED")
                  if (fbPend.length > 0) pending = fbPend
                }
              } catch {}
            }
            if (pending.length > 0) {
              const hint = `[RECOVERY: te quedan ${pending.slice(0, 3).join(",")}${pending.length > 3 ? `, +${pending.length - 3} más` : ""} - usa get_handoff / mem_context para retomar]`
              event.system.push({ type: "text", text: hint })
            }
          }
        } catch {}
      }

      // ── Save nudge ──────────────────────────────────────────────────────────
      // Skip nudge for trivial greeting (cache-friendly, no extra injection)
      if (shouldBeTrivial) return
      // If it has been a long time since the last mem_save, append a reminder
      // to the system context so the agent notices. All fetches are fire-and-
      // forget with short timeouts — any failure silently skips the nudge.
      try {
        if (!sessionId || subAgentSessions.has(sessionId)) return

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
        const lastNudge = lastNudgeTime.get(sessionId)
        if (lastNudge !== undefined && nowSecs - lastNudge < cooldownSecs) return

        // Skip if the session is too young (< 5 minutes)
        let sessionStartEpoch = 0
        try {
          const sessionRes = await fetch(`${ENGRAM_URL}/sessions/${encodeURIComponent(sessionId)}`, {
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

        // Append the nudge to system context
        const nudge =
          "MEMORY REMINDER: It's been over 15 minutes since your last memory save. " +
          "If you've made decisions, discoveries, completed significant work, or found non-obvious things, " +
          "call mem_save now."
        event.system.push({ type: "text", text: nudge })
        lastNudgeTime.set(sessionId, nowSecs)
      } catch {
        // Any unexpected error — silently skip the nudge, never crash the hook
      }
    })

    // ─── Compaction Hook: Persist memory + inject context ──────────
    // Compaction is triggered by the system (not the agent) when context
    // gets too long. The old agent "dies" and a new one starts with the
    // compacted summary. This is our chance to:
    // 1. Auto-save a session checkpoint (the agent can't do this itself)
    // 2. Inject context from previous sessions into the compaction prompt
    // 3. Tell the compressor to remind the new agent to save memories

    await ctx.session.hook("compaction", async (event) => {
      if (event.sessionID) {
        await ensureSession(event.sessionID)
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
          const candidates = [join(directory, "opencode.json"), join(directory, "opencode.jsonc")]
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
                ?? (cfg as any)?.mcp?.servers?.["ostacky-controller"]?.environment?.OSTACKY_STATE_PATH
              if (typeof envPath === "string" && envPath) {
                statePath = envPath
                break
              }
            } catch {}
          }
        }
        if (!statePath) statePath = join(directory, ".opencode", "ostacky-state.json")
        const fallbackPath = join(dirname(statePath), ".ostacky-handoff-compaction.json")
        try { mkdirSync(dirname(fallbackPath), { recursive: true }) } catch {}
        const contextSnippet = (() => {
          try {
            return JSON.stringify(event.messages.slice(0, 2)).slice(0, 1000)
          } catch { return "" }
        })()
        const payload = {
          summary: `Compaction fallback for session ${event.sessionID ?? "unknown"} — project ${project}`,
          nextSteps: [] as string[],
          pendingTasks: [] as string[],
          ts: Date.now(),
          contextSnippet,
        }
        const tmp = `${fallbackPath}.tmp.${process.pid}`
        writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8")
        renameSync(tmp, fallbackPath)
      } catch {
        // fallback is best-effort — never crash compacting
      }

      // Inject context from previous sessions into the summarizer's system
      const data = await engramFetch(
        `/context?project=${encodeURIComponent(project)}`
      )
      if (data?.context) {
        event.system.push({ type: "text", text: data.context })
      }

      // Tell the compressor to instruct the new agent to persist the
      // compacted summary to Engram. The new agent reads the compacted
      // summary and this instruction, then saves it as a session summary.
      event.system.push({
        type: "text",
        text:
          `CRITICAL INSTRUCTION FOR COMPACTED SUMMARY:\n` +
          `The agent has access to Engram persistent memory via MCP tools.\n` +
          `You MUST include the following instruction at the TOP of the compacted summary:\n\n` +
          `"FIRST ACTION REQUIRED: Call mem_session_summary with the content of this compacted summary. ` +
          `Use project: '${project}'. This preserves what was accomplished before compaction. Do this BEFORE any other work."\n\n` +
          `This is NOT optional. Without this, everything done before compaction is lost from memory.`,
      })
    })

    return () => eventController.abort()
  },
}
