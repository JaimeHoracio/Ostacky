/**
 * Ostacky Controller — Plugin híbrido como alma (OpenCode V2)
 *
 * Fusiona assets/mcp/ostacky-controller/index.js + assets/plugins/ostacky-guard.ts
 * Mantiene máquina de 13 estados en-process y aplica hard gates en tool hook execute.before.
 * MCP queda thin solo para observabilidad (get_*).
 *
 * Single source security: mirrors generados desde src/security.ts via scripts/sync-controller-core.ts
 * Discovery: `codegraph_explore` completado; no hay cache de archivo.
 * Tiered cache-friendly: isTrivial sin reemplazar system[0], suffix hint + SKIP.
 * CodeGraph preventivo: bloquea Read/Grep masivo sin Discovery hit.
 */

// NOTA: sin `import { Plugin } from "@opencode/plugin"` a propósito — el server
// V2 no resuelve ese paquete desde `.opencode/plugins/` (Die ResolveMessage) y
// `Plugin.define()` es passthrough ({id, setup}). Objeto literal + `import type`
// (solo tipos, borrado al transpilar) cargan sin dependencias externas.
import type { Plugin } from "@opencode/plugin"
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs"
import { join, dirname, basename, resolve, relative, delimiter } from "node:path"
import { SENSITIVE_DEFAULT, BASH_SENSITIVE_RE, isSensitive, extractPathsFromBash } from "./security.ts"
import { isTrivial } from "./tiered.ts"
import { STATES, TRANSITIONS, DEFAULT_STATE } from "./controller-core.ts"

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_STATE_FILE_SIZE = 2 * 1024 * 1024
const PING_INTERVAL_MS = 60_000
const IDLE_THRESHOLD_MS = 45_000

// DEFAULT_STATE imported from controller-core.ts

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getStatePath(directory: string): string {
  if (process.env.OSTACKY_STATE_PATH) return process.env.OSTACKY_STATE_PATH
  const candidates = [join(directory, "opencode.json"), join(directory, "opencode.jsonc")]
  for (const cand of candidates) {
    try {
      const raw = readFileSync(cand, "utf-8")
      const json = JSON.parse(raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))
      const envPath = (json as any)?.mcp?.["ostacky-controller"]?.environment?.OSTACKY_STATE_PATH
        ?? (json as any)?.mcp?.servers?.["ostacky-controller"]?.environment?.OSTACKY_STATE_PATH
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

/** Sleep sincrónico acotado — los call sites del plugin son sync. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      /* spin de último recurso */
    }
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Toma EL MISMO lock que el MCP (`<state>.lock.pid` con `wx`) para serializar
 * plugin ↔ MCP cross-proceso. Devuelve una función de release; si no se pudo
 * tomar, devuelve un no-op (la escritura sigue siendo segura por el merge).
 */
function acquireStateLock(statePath: string): () => void {
  const pidPath = statePath + ".lock.pid"
  const tsPath = statePath + ".lock.timestamp"
  const staleWindow = 15_000
  let acquired = false
  for (let attempt = 0; attempt < 8 && !acquired; attempt++) {
    // Lock viejo: solo lo liberamos si el dueño NO está vivo (mismo criterio que el MCP).
    try {
      const ts = parseInt(readFileSync(tsPath, "utf-8"), 10)
      if (!Number.isNaN(ts) && Date.now() - ts >= staleWindow) {
        const owner = parseInt(readFileSync(pidPath, "utf-8").trim(), 10)
        if (!isPidAlive(owner)) {
          try { unlinkSync(pidPath) } catch {}
          try { unlinkSync(tsPath) } catch {}
        }
      }
    } catch {}
    try {
      writeFileSync(pidPath, String(process.pid), { encoding: "utf-8", flag: "wx" })
      try { writeFileSync(tsPath, String(Date.now()), "utf-8") } catch {}
      acquired = true
    } catch {
      sleepSync(5 + attempt * 10)
    }
  }
  if (!acquired) return () => {}
  return () => {
    try {
      if (readFileSync(pidPath, "utf-8").trim() !== String(process.pid)) return
    } catch {
      return
    }
    try { unlinkSync(pidPath) } catch {}
    try { unlinkSync(tsPath) } catch {}
  }
}

let persistSeq = 0

/**
 * Merge puro: parte del estado FRESCO de disco y le aplica SOLO las claves que
 * el plugin posee. Garantiza estructuralmente que una escritura del plugin no
 * pueda borrar un avance del MCP (transición, audit, tasks, revision).
 */
export function mergePluginOwnedState(fresh: any, state: any, ownedKeys: string[]): any {
  const payload: any = { ...fresh }
  for (const k of ownedKeys) {
    if (Object.prototype.hasOwnProperty.call(state, k)) payload[k] = state[k]
  }
  return payload
}

/**
 * Persiste estado SIN poder pisar al MCP.
 *
 * El MCP es la autoridad de la máquina de estados; el plugin solo escribe un
 * puñado de campos "advisory" (`ownedKeys`). Antes el plugin hacía
 * readState → mutar → write del snapshot COMPLETO: si el MCP avanzaba en el
 * medio (transición/audit/tasks), la escritura del plugin borraba ese avance.
 *
 * Ahora: (1) lock compartido con el MCP, (2) re-lectura fresca de disco DENTRO
 * del lock, (3) se aplican SOLO las claves propias sobre el estado fresco,
 * (4) write atómico (tmp único + rename). El `revision` se preserva del disco:
 * las escrituras del plugin no son transiciones de la máquina de estados.
 */
export function persistState(directory: string, state: any, ownedKeys?: string[]): void {
  const p = getStatePath(directory)
  const dir = dirname(p)
  try { mkdirSync(dir, { recursive: true }) } catch {}

  const release = acquireStateLock(p)
  try {
    let payload: any = state
    if (ownedKeys && ownedKeys.length > 0) {
      let fresh: any = null
      try { fresh = JSON.parse(readFileSync(p, "utf-8")) } catch {}
      if (fresh && typeof fresh === "object" && !Array.isArray(fresh)) {
        payload = mergePluginOwnedState(fresh, state, ownedKeys)
      }
    }
    let serialized = JSON.stringify(payload, null, 2)
    if (serialized.length > MAX_STATE_FILE_SIZE) {
      payload.stateOversizedCount = (payload.stateOversizedCount || 0) + 1
      const trimmed = { ...payload, snapshots: { codegraph: null, execution: null }, audit: (payload.audit || []).slice(-50) }
      serialized = JSON.stringify(trimmed, null, 2)
      if (serialized.length > MAX_STATE_FILE_SIZE) return
      payload.snapshots = { codegraph: null, execution: null }
      serialized = JSON.stringify(payload, null, 2)
    }
    const tmp = p + ".tmp." + process.pid + "." + ++persistSeq
    try {
      writeFileSync(tmp, serialized, "utf-8")
      renameSync(tmp, p)
      try { renameSync(p + ".backup", p + ".backup.1") } catch {}
      try { renameSync(p + ".backup.1", p + ".backup.2") } catch {}
      try {
        const backupTmp = p + ".backup.tmp." + process.pid + "." + persistSeq
        writeFileSync(backupTmp, serialized, "utf-8")
        renameSync(backupTmp, p + ".backup")
      } catch {}
    } catch {}
  } finally {
    release()
  }
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

function isCodegraphAvailable(directory: string): boolean {
  // If codegraph binary exists, assume OK. Otherwise fallback allows Read.
  try {
    const bin = join(directory, ".opencode", "tools", "codegraph", "bin", "codegraph")
    const binExe = bin + ".exe"
    if (existsSync(bin) || existsSync(binExe)) return true
    // also check PATH
    if (lookupOnPath("codegraph")) return true
    return false
  } catch { return false }
}

/**
 * ¿Este read/grep/glob esta sujeto al gate de discovery?
 * Exenciones: docs/json/md, openspec/changes|specs, grep de literales, y archivos ya
 * trackeados (refresh honesto post-complete necesita Read fresco sin Discovery hit).
 */
export function isCodeReadGated(input: {
  isCodeFile: boolean
  isLiteralGrep: boolean
  isSpecTasksPath: boolean
  isDocsPath: boolean
  isTaskTracked: boolean
}): boolean {
  return (
    input.isCodeFile &&
    !input.isLiteralGrep &&
    !input.isSpecTasksPath &&
    !input.isDocsPath &&
    !input.isTaskTracked
  )
}

/**
 * Predicado puro del gate de CodeGraph: ¿bloquear esta lectura de codigo?
 *
 * Extraido a funcion para poder testear el INVARIANTE, no el mensaje. El test anterior hacia
 * `expect(src).toContain("Usa getDiscoverySnapshot primero")`: verificaba que el texto existiera
 * y pasaba verde con el gate inescapable adentro (fix-codegraph-gate).
 */
export function shouldBlockCodeRead(input: {
  isCodeFile: boolean
  isLiteralGrep: boolean
  isSpecTasksPath: boolean
  isDocsPath: boolean
  isTaskTracked: boolean
  codegraphOk: boolean
  hasDiscoveryHit: boolean
}): boolean {
  return isCodeReadGated(input) && input.codegraphOk && !input.hasDiscoveryHit
}

/**
 * Tools cuyo completado constituye evidencia REAL de discovery estructural en la sesion.
 *
 * `codegraph_explore` es la senal fuerte: llamada real, resultado inspeccionable por el plugin.
 * No hay cache de discovery: `getDiscoverySnapshot` nunca existió y se retiró.
 *
 * Historia (fix-codegraph-gate): antes la UNICA senal era `getDiscoverySnapshot`, una tool que nunca
 * se registro ni en el plugin ni en el MCP. `hasDiscoveryHit` era siempre false y el gate bloqueaba
 * todo read/grep/glob de codigo sin salida posible; un `codegraph_explore` completado NO lo abria,
 * contradiciendo la instruccion "CodeGraph primero" del agente.
 */
export function marksDiscovery(toolName: string): boolean {
  return (
    toolName.includes("codegraph_explore")
  )
}

/**
 * Mismo criterio de "archivo de código" que el gate de read (index.ts:552),
 * sin la cláusula de `pattern` que es específica de glob. Docs/JSON quedan fuera:
 * un .md bajo assets/ es documentación, no código.
 */
export function isCodePath(p: string): boolean {
  if (!p) return false
  if (/\.(md|json)$/i.test(p)) return false
  return /\.(ts|js|tsx|jsx|mts|cts)$/i.test(p) || p.includes("src/") || p.includes("assets/")
}

/**
 * Evidencia de una corrida de shell para las tasks `test:` (change
 * test-verification-execution). Devuelve null si el evento no permite afirmar
 * nada: sin comando o sin `exit` numérico.
 *
 * NO consulta `status`: medido en OpenCode 2.0.32, `sh -c 'exit 3'` llega con
 * `status: "completed"` y `result.metadata.status: "completed"`. El único dato
 * veraz es `result.metadata.exit`.
 */
export function shellEvidence(event: any): { cmd: string; exit: number; ts: number } | null {
  if (!event || event.tool !== "shell") return null
  const cmd = event.input?.command
  const exit = event.result?.metadata?.exit
  if (typeof cmd !== "string" || !cmd.trim()) return null
  if (typeof exit !== "number") return null
  return { cmd: cmd.trim(), exit, ts: Date.now() }
}

/** Tools que mutan archivos: avanzan `lastMutationTs`. */
export function isMutatingTool(tool: string): boolean {
  return tool === "edit" || tool === "write" || tool === "patch"
}

/**
 * Comando shell que escribe en disco. Predicado compartido por el gate de
 * mutación y por `lastMutationTs`: si no se compartiera, un `sed -i` aprobado
 * por el gate mutaría el código sin avanzar el timestamp, y una corrida de test
 * previa seguiría contando como evidencia.
 */
export function isShellMutation(command: string): boolean {
  if (!command) return false
  // `2>&1`, `1>&2`, `2>/dev/null` son redirects de stderr, no mutación.
  const cmdSansStderr = command.replace(/2>&1/g, "").replace(/1>&2/g, "").replace(/2>\s*\/dev\/null/g, "")
  return /(^|[^0-9&])>{1,2}\s*(?!&)\S+|\bsed\b[^|;]*-i|\btruncate\b|\btee\b|\bcp\s+|\bmv\s+|\brm\s+|python.*open.*w/.test(cmdSansStderr)
}

/**
 * Verbos cuyo output revela el CONTENIDO de un archivo. No incluye verbos que
 * sólo mencionan paths (`bun test x.ts`, `tsc src/x.ts`, `git diff`): el gate
 * distingue "revela" de "menciona" — ver change shell-code-read-gate.
 */
const SHELL_READ_VERBS = new Set([
  "cat", "head", "tail", "sed", "awk", "grep", "rg", "ag", "ack", "less", "more",
  "nl", "bat", "tac", "strings", "xxd", "od", "base64", "diff", "cut", "paste",
  "sort", "uniq", "column", "expand", "fold",
])

const SHELL_WRAPPERS = new Set(["sudo", "env", "time", "command", "exec", "nohup"])

/**
 * Paths de código que `command` REVELA (no los que menciona).
 *
 * Fail-open por diseño: redirección => escritura, `sed -i` => escritura, verbo
 * fuera de la allowlist => []. Un gate de shell nunca es hermético; el objetivo
 * es quitar el bypass casual (`cat src/x.ts`), no demostrar imposibilidad.
 * Bypass residual documentado en el spec: `git show`, `python -c`, `node -e`,
 * `find -exec`, `xargs`.
 */
export function shellReadTargets(command: string): string[] {
  if (!command) return []
  const targets: string[] = []
  // Split por pipes/separadores, NO por `>`: necesitamos ver la redirección.
  const segments = command.replace(/&&/g, ";").replace(/\|\|/g, ";").split(/[|;\n]+/)
  for (const seg of segments) {
    const trimmed = seg
      // Redirects de stderr no son escritura: sin esto, `cat src/x.ts 2>&1`
      // pasaba el check `>` de abajo y se colaba del gate (bypass casual).
      // Mismo criterio que isShellMutation, el sibling de este módulo.
      .replace(/2>&1/g, "")
      .replace(/1>&2/g, "")
      .replace(/2>\s*\/dev\/null/g, "")
      .trim()
    if (!trimmed) continue
    // Escritura real (cat > f, tee, heredoc): no es lectura.
    if (/>/.test(trimmed)) continue
    const tokens = (trimmed.match(/(?:[^\s"'`\\]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) || [])
      .map((t) => t.replace(/["'`]/g, "").replace(/\\/g, ""))
      .filter(Boolean)
    if (tokens.length === 0) continue
    let i = 0
    while (i < tokens.length && SHELL_WRAPPERS.has(tokens[i])) i++
    const verb = tokens[i] || ""
    const base = verb.split("/").pop() || verb
    if (!SHELL_READ_VERBS.has(base)) continue
    // sed -i es escritura in-place, no lectura.
    if (base === "sed" && tokens.some((t) => t === "-i" || t.startsWith("-i") || t === "--in-place" || t.startsWith("--in-place"))) continue
    // diff -q/--brief/--stat sólo compara metadatos: no revela contenido.
    if (base === "diff" && tokens.some((t) => t === "-q" || t === "--quiet" || t === "--brief" || t === "--stat" || /^-[a-zA-Z]*q[a-zA-Z]*$/.test(t))) continue
    for (const p of extractPathsFromBash(trimmed)) {
      if (isCodePath(p)) targets.push(p)
    }
  }
  return [...new Set(targets)]
}

/**
 * Predicado puro del gate de shell: ¿leer este path por shell está EXENTO?
 *
 * Extraído del hook para poder testear el INVARIANTE (mismo criterio que
 * shouldBlockCodeRead). Exenciones:
 * 1. Paths FUERA del proyecto: no son código de este codebase (fixtures
 *    temporales de tests, reportes generados); bloquearlos rompe pipelines sin
 *    escape hatch — el falso positivo que el diseño prohibió.
 * 2. Specs/docs (.md/.json, openspec, assets/docs).
 * 3. Archivos ya trackeados en tasks/fileFingerprints/lastValidated (el refresh
 *    honesto post-complete necesita re-leerlos).
 */
export function isShellPathExempt(p: string, directory: string, freshState: any): boolean {
  if (!isPathInsideProject(p, directory)) return true
  if (p.includes("openspec/changes") || p.includes("openspec/specs")) return true
  if (p.includes("assets/docs") || p.includes("/docs/") || /\.md$/i.test(p) || /\.json$/i.test(p)) return true
  try {
    if (freshState) {
      const fps = Object.keys(freshState.fileFingerprints || {})
      const taskFiles = Object.values(freshState.tasks || {}).map((t: any) => t.filePath).filter(Boolean)
      const lv: any = (freshState as any).lastValidated || null
      const lvByFile = lv?.byFile && typeof lv.byFile === "object" ? lv.byFile : null
      const lvPaths: string[] = [
        ...(lvByFile ? Object.keys(lvByFile) : []),
        ...(lv?.filePath ? [lv.filePath as string] : []),
      ]
      const matches = (f: string): boolean => p.endsWith(f) || f.endsWith(p) || p.includes(f) || f.includes(p)
      if (fps.some(matches) || taskFiles.some(matches)) return true
      if (lvPaths.some((lf) => p.endsWith(lf) || lf.endsWith(p))) return true
    }
  } catch {}
  return false
}

/** Comandos `test:` declarados en taskVerifications, ya normalizados (sin prefijo). */
export function testVerifyCommands(state: any): Set<string> {
  const out = new Set<string>()
  try {
    for (const v of Object.values((state as any)?.taskVerifications || {})) {
      if (typeof v === "string" && v.trim().startsWith("test:")) {
        const cmd = v.trim().slice("test:".length).trim()
        if (cmd) out.add(cmd)
      }
    }
  } catch {}
  return out
}

function jsonContent(value: unknown): { content: string } {
  try {
    return { content: JSON.stringify(value) ?? "null" }
  } catch {
    return { content: "null" }
  }
}

/**
 * Extrae paths de un patchText V2 (`*** Add File: <path>`, Update/Delete/Move).
 * Move trae `old --> new`: se revisan ambos lados.
 */
function extractPathsFromPatch(patchText: string): string[] {
  if (!patchText) return []
  const paths: string[] = []
  const re = /^\*\*\* (?:Add File|Update File|Delete File|Move File):\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(patchText)) !== null) {
    const rest = (m[1] ?? "").trim()
    for (const part of rest.split(/\s+-->\s+|\s+->\s+/)) {
      const p = part.trim().replace(/^["']|["']$/g, "")
      if (p) paths.push(p)
    }
  }
  return [...new Set(paths)]
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

// Objeto literal directo (ver nota en imports): el server V2 acepta
// `{ id, setup }` sin pasar por `Plugin.define()`.
export default {
  id: "ostacky-controller",
  async setup(ctx) {
    const directory = ctx.location.directory

    // Track trivial flag per session to gate tools
    const trivialBySession = new Map<string, boolean>()
    // Track discovery hit per requestId to avoid blocking after hit
    const discoveryHitByRequest = new Map<string, boolean>()
    // Track Engram hit per session to audit bypass (soft, no BLOCK)
    const engramHitBySession = new Map<string, boolean>()
    // ─── Heartbeat ping — evita sensación de trancado en tareas largas ──
    let lastPingTs = 0
    let pingInterval: ReturnType<typeof setInterval> | null = null

    const patterns = (() => {
      const raw = process.env.OSTACKY_SENSITIVE_PATTERNS
      if (!raw) return SENSITIVE_DEFAULT
      return raw.split(",").map((s: string) => s.trim()).filter(Boolean)
    })()

    let lastCheck: { revision: number; result: string } | null = null
    let checkCount = 0

    // Heartbeat ping — evita sensación de trancado en tareas largas
    // (V2: sin canal TUI en ctx; se loguea al server log y se persiste lastPingTs)
    if (!pingInterval) {
      pingInterval = setInterval(() => {
        try {
          const s = readState(directory)
          if (!s || !["EXECUTING_INLINE", "EXECUTING_SUBAGENTS", "SYNC"].includes(s.state)) return
          const now = Date.now()
          const lastHeartbeat = s.lastHeartbeat || s.ts || now
          const idle = now - lastHeartbeat
          if (idle < IDLE_THRESHOLD_MS) return
          if (now - lastPingTs < PING_INTERVAL_MS) return
          lastPingTs = now
          const completed = Object.values(s.tasks || {}).filter((t: any) => t.status === "COMPLETED").length
          const total = s.expectedTaskCount ?? s.expectedTasks?.length ?? "?"
          const pending = Array.isArray(s.expectedTasks) ? s.expectedTasks.filter((id: string) => !s.tasks?.[id] || s.tasks[id].status !== "COMPLETED").length : "?"
          const msg = `[ostacky] Sigo trabajando — ${s.state} • ${completed}/${total} (${pending} pendientes) • hace ${Math.round(idle/1000)}s sin output`
          try { console.log(msg) } catch {}
          try { const st = readState(directory); if (st) { (st as any).lastPingTs = now; persistState(directory, st, ["lastPingTs"]) } } catch {}
        } catch {}
      }, 30_000)
      if (pingInterval && typeof (pingInterval as any).unref === 'function') (pingInterval as any).unref()
    }

    // ── Tiered: suffix hint on user message (cache-friendly, no system replace) ──
    await ctx.session.hook("prompt", (event) => {
      const sessionId: string = event.sessionID ?? "default"
      const text = (event.prompt.text ?? "").trim()
      const state = readState(directory)
      // task-verification-integrity D4: registrar el texto ORIGINAL del usuario (antes de los
      // hints de abajo) para que `implementation_complete({force:true})` se apoye en evidencia
      // real y no en el audit, que lo redacta el agente. `ownedKeys` evita pisar el avance del MCP.
      // Cada prompt lleva `ts`: el MCP sólo acepta confirmaciones POSTERIORES al último
      // intento de force, así un "¿qué hace force:true?" viejo no abre el gate.
      if (text && state) {
        try {
          const prev = Array.isArray((state as any).lastUserPrompts) ? (state as any).lastUserPrompts : []
          ;(state as any).lastUserPrompts = [...prev, { text: text.slice(0, 500), ts: Date.now() }].slice(-5)
          persistState(directory, state, ["lastUserPrompts"])
        } catch {}
      }
      const currentState = state?.state ?? "DONE"
      const trivial = isTrivial(text, currentState)
      trivialBySession.set(sessionId, trivial)
      if (trivial) {
        // Preserve system FULL cacheable, add suffix hint to user prompt text
        const hint = "\n\n[PLUGIN HINT: Saludo trivial — responde breve sin tools. No hagas Discovery.]"
        event.prompt.text = (event.prompt.text ?? "") + hint
      }
      // harden-compaction-resume: auto-inject recovery hint when pending (determinístico, no depende del modelo)
      if (!trivial && state && !["DONE", "INTERPRETATION_PENDING"].includes(state.state)) {
        try {
          let pending: string[] = Array.isArray(state.lastHandoff?.pendingTasks)
            ? state.lastHandoff.pendingTasks.filter((id: string) => !state.tasks?.[id] || state.tasks[id].status !== "COMPLETED")
            : []
          if (pending.length === 0) {
            try {
              const fallbackPath = join(dirname(getStatePath(directory)), ".ostacky-handoff-compaction.json")
              if (existsSync(fallbackPath)) {
                const raw = readFileSync(fallbackPath, "utf-8")
                const data = JSON.parse(raw)
                if (data && Array.isArray(data.pendingTasks) && typeof data.ts === "number" && Date.now() - data.ts < 24 * 60 * 60 * 1000) {
                  const fbPending = data.pendingTasks.filter((id: string) => !state.tasks?.[id] || state.tasks[id].status !== "COMPLETED")
                  if (fbPending.length > 0) pending = fbPending
                }
              }
            } catch {}
          }
          if (pending.length > 0) {
            const hint = `\n\n[RECOVERY: te quedan ${pending.slice(0, 3).join(",")}${pending.length > 3 ? `, +${pending.length - 3} más` : ""} - usa get_handoff / mem_context para retomar]`
            event.prompt.text = (event.prompt.text ?? "") + hint
          }
        } catch {}
      }
    })

    // ── Hard gates before any tool ──
    await ctx.tool.hook("execute.before", (event) => {
      const tool: string = event.tool as string
      const args: any = (event.input ?? {}) as any
      const sessionId: string = (event.sessionID ?? "default") as string

      // ── 0) Trivial greeting blocks for expensive tools (SKIP, not BLOCKED) ──
      const isTrivialSession = trivialBySession.get(sessionId) ?? false
      const stateForTrivial = readState(directory)
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
      const freshState = readState(directory)
      const pendingStates = ["ROUTE_DECISION_PENDING", "EXECUTION_DECISION_PENDING", "CLARIFICATION_PENDING"]
      if (freshState && pendingStates.includes(freshState.state)) {
        // cache ALLOW per revision, BLOCKED never cached
        if (lastCheck && freshState.revision === lastCheck.revision && checkCount % 5 !== 0 && lastCheck.result === "ALLOW") {
          // reuse cached ALLOW
        } else {
          lastCheck = { revision: freshState.revision, result: pendingStates.includes(freshState.state) ? "BLOCKED" : "ALLOW" }
        }
        if (lastCheck.result === "BLOCKED") {
          const allowed = ["consume_route_decision", "consume_execution_decision", "refresh_decision", "record_clarification", "abandon", "check_file_access", "consume_file_access_decision", "record_user_confirmation"]
          // Observabilidad read-only: leer estado/auditoría para obtener decisionId no debe deadloquear
          const observable = ["get_state", "get_audit", "get_metrics", "get_handoff", "get_available_transitions", "get_tasks"]
          const isControllerTool = tool.startsWith("ostacky-controller_") || tool.startsWith("ostacky_") || allowed.some(t => tool.includes(t)) || observable.some(t => tool.includes(t))
          // Code Mode deadlock fix: `execute` es wrapper cuyo outer siempre es "execute" — inspeccionar intent interno
          const codeStr = typeof (args as any)?.code === "string" ? (args as any).code : typeof (args as any)?.input === "string" ? (args as any).input : ""
          const isExecuteWithAllowed = tool === "execute" && codeStr && allowed.some(t => codeStr.includes(t))
          // Observabilidad via execute wrapper: get_state/get_audit para obtener decisionId no deben bloquearse en PENDING
          const isExecuteWithObservable = tool === "execute" && codeStr && observable.some(t => codeStr.includes(t))
          if (!isControllerTool && !isExecuteWithAllowed && !isExecuteWithObservable) {
            throw new Error(`BLOCKED: call consume_* first — controller is in ${freshState.state}`)
          }
        }
      } else if (freshState) {
        lastCheck = { revision: freshState.revision, result: "ALLOW" }
      }

      // ── 1.6) Engram soft gate (auditable, no BLOCK) — refuerza SHALL 1 de ostacky.md ──
      // Si propone/cambia nivel sin haber consultado Engram, cuenta bypass (exime trivial+DONE)
      const isEngramRelevantTool = tool.includes("record_discovery") || (tool.includes("openspec") && (tool.includes("propose") || (typeof args?.filePath === "string" && args.filePath.includes("openspec/changes")) || (typeof args?.path === "string" && args.path.includes("openspec/changes"))))
      if (isEngramRelevantTool) {
        const hasEngramHit = engramHitBySession.get(sessionId) ?? false
        const isTrivialForEngram = trivialBySession.get(sessionId) ?? false
        const stateForEngram = freshState
        const shouldAudit = !hasEngramHit && !isTrivialForEngram && stateForEngram && ["DISCOVERY", "ROUTE_DECISION_PENDING", "SPECIFICATION", "INTERPRETATION_PENDING"].includes(stateForEngram.state)
        if (shouldAudit) {
          try {
            const st = readState(directory)
            if (st) {
              st.engramBypassCount = (st.engramBypassCount || 0) + 1
              // no persist cada vez si es muy frecuente: single-writer ya persiste en after, pero acá persistimos directo para auditoría
              persistState(directory, st, ["engramBypassCount"])
            }
          } catch {}
        }
      }

      // ── 1.5) Router determinista: openspec-propose bloquea si 1+ no-downgradeable sin Alternatives ──
      const isOpenspecPropose = tool.includes("openspec") && (tool.includes("propose") || args?.filePath?.includes("openspec/changes") || args?.path?.includes("openspec/changes"))
      if (isOpenspecPropose) {
        const s = readState(directory)
        if (s?.level === "1+" && s?._routerNeedsAlternatives) {
          // check if design.md has Alternatives
          try {
            const changeId = args?.changeId || s?.changeId || ""
            let designPath: string | null = null
            if (changeId) designPath = join(directory, "openspec", "changes", changeId, "design.md")
            else {
              // try to find any change dir with _routerNeedsAlternatives
              const changesDir = join(directory, "openspec", "changes")
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
        // harden-task-integrity 1.3: eximir reads de tasks.md del gate (no requiere CodeGraph)
        const isSpecTasksPath = targetPath.includes("openspec/changes") || targetPath.includes("openspec/specs")
        // Docs y markdown nunca son código: no exigir Discovery (fix over-blocking assets/docs)
        const isDocsPath = targetPath.includes("assets/docs") || targetPath.includes("/docs/") || /\.md$/i.test(targetPath) || /\.json$/i.test(targetPath)
        // Grep on *.md should not be blocked
        const isLiteralGrep = tool === "grep" && (args?.include?.endsWith(".md") || args?.include?.endsWith(".json"))
        // Refresh honesto: revalidación post-complete necesita Read fresco sin Discovery hit.
        // Vale para SPEC y DIRECT, INLINE y SUBAGENTS: si el path está trackeado en
        // tasks/fileFingerprints/lastValidated, no exigir Discovery.
        let isTaskTracked = false
        try {
          const st = freshState
          if (st && targetPath) {
            const fps = Object.keys(st.fileFingerprints || {})
            const taskFiles = Object.values(st.tasks || {}).map((t: any) => t.filePath).filter(Boolean)
            const lv: any = (st as any).lastValidated || null
            const lvByFile = lv?.byFile && typeof lv.byFile === 'object' ? lv.byFile : null
            const lvPaths: string[] = [
              ...(lvByFile ? Object.keys(lvByFile) : []),
              ...(lv?.filePath ? [lv.filePath as string] : []),
            ]
            const lvFile = lvPaths.length > 0 ? lvPaths : null
            isTaskTracked =
              fps.some((fp) => targetPath.endsWith(fp) || fp.endsWith(targetPath) || targetPath.includes(fp) || fp.includes(targetPath)) ||
              taskFiles.some((fp: string) => targetPath.endsWith(fp) || fp.endsWith(targetPath) || targetPath.includes(fp) || fp.includes(targetPath)) ||
              (lvFile ? lvFile.some((lf) => targetPath.endsWith(lf) || lf.endsWith(targetPath)) : false)
          }
        } catch {}
        // Orden cheap -> caro: el path no hace I/O; codegraph y la cache en disco solo se evalúan
        // si el path esta realmente sujeto al gate (`read`/`grep`/`glob` corren en cada turno).
        const gated = isCodeReadGated({ isCodeFile, isLiteralGrep, isSpecTasksPath, isDocsPath, isTaskTracked })
        const codegraphOk = gated ? isCodegraphAvailable(directory) : false
        // Sin fallback a disco: la única evidencia válida es un codegraph_explore
        // COMPLETADO en esta sesión (discoveryHitByRequest). El memo se limpia con
        // session.deleted, así "esta sesión" es literal.
        const hasDiscoveryHit = codegraphOk ? discoveryHitByRequest.get(sessionId) === true : false
        if (shouldBlockCodeRead({
          isCodeFile, isLiteralGrep, isSpecTasksPath, isDocsPath, isTaskTracked, codegraphOk, hasDiscoveryHit,
        })) {
          throw new Error(
            `BLOCKED: sin discovery estructural en esta sesión — llamá codegraph_codegraph_explore("${targetPath || "query"}") antes de Read/Grep/Glob de código`
          )
        }
      }

      // ── 3) Sensitive gate (hard, even in degraded) ──
      if (tool === "shell") {
        const cmd: string = args?.command || args?.cmd || ""
        if (typeof cmd === "string" && cmd) {
          const normalized = cmd.replace(/["'`]/g, "").replace(/\\/g, "")
          const hasSensitivePattern = BASH_SENSITIVE_RE.test(normalized)
          const paths = extractPathsFromBash(cmd)
          const sensitivePaths = paths.filter((p) => isSensitive(p, patterns))
          if (hasSensitivePattern || sensitivePaths.length > 0) {
            if (sensitivePaths.length > 0) {
              for (const p of sensitivePaths) {
                const s = readState(directory)
                const candidates = [p, resolve(directory, p), join(directory, p)]
                const allowed = candidates.some((c) => s?.allowedFiles?.[c] || s?.allowedFiles?.[p])
                const baseAllowed = s?.allowedFiles?.[p] || s?.allowedFiles?.[basename(p)] || s?.allowedFiles?.[resolve(directory, p)]
                if (!allowed && !baseAllowed) {
                  const denied = s?.deniedFiles?.[p] || s?.deniedFiles?.[basename(p)]
                  if (denied) throw new Error(`BLOCKED: shell contiene acceso sensible (${p}) (previously denied) — Llamá check_file_access con reason antes.`)
                  throw new Error(`BLOCKED: shell contiene acceso sensible (${p}). Llamá check_file_access con reason antes.`)
                }
              }
            } else if (hasSensitivePattern) {
              const s = readState(directory)
              const hasAllowed = Object.keys(s?.allowedFiles || {}).some((k) => isSensitive(k, patterns))
              if (!hasAllowed) throw new Error(`BLOCKED: shell contiene acceso sensible (.env). Llamá check_file_access con reason antes.`)
            }
          }
        }
      }

      // ── 3.2) CodeGraph gate para shell: leer código sin discovery → BLOCKED ──
      // El gate de código (arriba) sólo mira read/grep/glob; `cat src/x.ts` revela
      // lo mismo y no costaba nada. Fail-open a propósito: `read` falla cerrado
      // porque es inequívoco; `shell` es ambiguo y un falso positivo rompe tests o
      // builds sin escape hatch para el usuario (change shell-code-read-gate).
      if (tool === "shell") {
        const cmdForRead: string = args?.command || args?.cmd || ""
        if (typeof cmdForRead === "string" && cmdForRead) {
          const shellTargets = shellReadTargets(cmdForRead)
          if (shellTargets.length > 0) {
            const gatedShell = shellTargets.filter((p) => !isShellPathExempt(p, directory, freshState))
            const codegraphOkShell = gatedShell.length > 0 ? isCodegraphAvailable(directory) : false
            const hasDiscoveryShell = codegraphOkShell ? discoveryHitByRequest.get(sessionId) === true : false
            if (gatedShell.length > 0 && codegraphOkShell && !hasDiscoveryShell) {
              throw new Error(
                `BLOCKED: sin discovery estructural en esta sesión — llamá codegraph_codegraph_explore("${gatedShell[0]}") antes de leer código por shell`
              )
            }
          }
        }
      }

      // ── 3.5) Shell file-mutation gate (harden-task-integrity: shell mutante requiere validate_edit) ──
      if (tool === "shell" && freshState && ["EXECUTING_INLINE", "EXECUTING_SUBAGENTS"].includes(freshState.state)) {
        const cmdForMutation: string = args?.command || args?.cmd || ""
        const isMutating = isShellMutation(cmdForMutation)
        if (isMutating) {
          const mPaths = extractPathsFromBash(cmdForMutation)
          for (const p of mPaths) {
            if (!p) continue
            const isProjectCode = p.includes("src/") || p.includes("assets/") || /\.(ts|js|tsx|jsx|mts|cts)$/i.test(p)
            if (!isProjectCode) continue
            if (!isPathInsideProject(p, directory)) continue
            const abs = resolve(directory, p)
            const exists = existsSync(abs)
            const isNewFile = !exists && !freshState.fileFingerprints?.[p] && !Object.values(freshState.tasks || {}).some((t: any) => t.filePath === p)
            if (isNewFile) continue
            const lv: any = (freshState as any).lastValidated
            const lvOk =
              lv && ((lv.byFile && typeof lv.byFile === 'object' && lv.byFile[p]) || (lv as any).filePath === p)
            if (!lvOk) {
              throw new Error(`BLOCKED: file mutation requires validate_edit/expectedTask for ${p} — usa validate_edit antes de shell mutante`)
            }
          }
        }
      }

      let filePath: string | undefined
      if (tool === "read" || tool === "read_mcp_resource" || tool === "grep" || tool === "glob" || tool === "edit" || tool === "write") {
        filePath = args?.filePath || args?.path || args?.pattern || args?.uri || ""
        if (tool === "grep" && args?.include) filePath = args.include
        if (tool === "edit" || tool === "write") filePath = args?.filePath || args?.path || ""
        if (tool === "read_mcp_resource" && typeof args?.uri === "string") {
          try {
            const u = args.uri as string
            if (u.startsWith("file://")) filePath = u.slice(7)
            else if (u.includes("/")) filePath = u
          } catch {}
        }
      }
      if (filePath && isSensitive(filePath, patterns)) {
        const s = readState(directory)
        const allowed = s?.allowedFiles?.[filePath] || s?.allowedFiles?.[resolve(directory, filePath)] || s?.allowedFiles?.[basename(filePath)]
        if (!allowed) {
          const denied = s?.deniedFiles?.[filePath] || s?.deniedFiles?.[basename(filePath)]
          if (denied) throw new Error(`BLOCKED: File ${filePath} requires check_file_access (previously denied)`)
          throw new Error(`BLOCKED: File ${filePath} requires check_file_access`)
        }
      }
      // patch usa patchText (no filePath): se chequean los paths mencionados
      if (tool === "patch" && typeof args?.patchText === "string" && args.patchText) {
        for (const patchPath of extractPathsFromPatch(args.patchText)) {
          if (!patchPath || !isSensitive(patchPath, patterns)) continue
          const s = readState(directory)
          const allowed = s?.allowedFiles?.[patchPath] || s?.allowedFiles?.[resolve(directory, patchPath)] || s?.allowedFiles?.[basename(patchPath)]
          if (!allowed) {
            const denied = s?.deniedFiles?.[patchPath] || s?.deniedFiles?.[basename(patchPath)]
            if (denied) throw new Error(`BLOCKED: File ${patchPath} requires check_file_access (previously denied)`)
            throw new Error(`BLOCKED: File ${patchPath} requires check_file_access`)
          }
        }
      }

      // ── 4) validate_edit in-process for edit/write (V2 keeps both tools; patch usa patchText y queda fuera — follow-up) ──
      if (tool === "edit" || tool === "write") {
        const oldString: string = args?.oldString ?? ""
        const newString: string = args?.newString ?? args?.content ?? ""
        const targetPath: string = args?.filePath || args?.path || ""
        if (targetPath && typeof oldString === "string" && typeof newString === "string") {
          if (oldString === newString) {
            throw new Error(`CONFLICT: oldString === newString`)
          }
          if (!isPathInsideProject(targetPath, directory)) {
            throw new Error(`BLOCKED: path outside project: ${targetPath}`)
          }
          // If oldString is hash:<fp> handle stale check
          if (oldString.startsWith("hash:")) {
            const claimed = oldString.slice(5)
            const currentFp = fastFingerprint(resolve(directory, targetPath))
            const s = readState(directory)
            const last: any = s?.lastValidated
            const lastEntry = last?.byFile?.[targetPath] || (last?.filePath === targetPath ? last : null)
            if (claimed !== currentFp || (lastEntry && lastEntry.hash !== currentFp)) {
              // mark stale attempt
              try {
                const st = readState(directory) || { ...DEFAULT_STATE }
                st.staleContentAttempts = (st.staleContentAttempts || 0) + 1
                persistState(directory, st, ["staleContentAttempts"])
              } catch {}
              throw new Error(`CONFLICT: stale fingerprint for ${targetPath}`)
            }
          } else if (oldString.length === 0) {
            // fix-new-file-gate: modo create explícito — solo válido si el archivo no existe en disco
            try {
              const fullPath = resolve(directory, targetPath)
              if (existsSync(fullPath)) {
                throw new Error(`CONFLICT: file exists, use replace mode for ${targetPath}`)
              }
            } catch (e: any) {
              if (e.message?.startsWith("CONFLICT")) throw e
              // error de fs distinto de existencia -> seguir (write decidirá)
            }
          } else if (oldString.length > 0) {
            // Check fresh content has exactly one occurrence
            try {
              const fullPath = resolve(directory, targetPath)
              if (existsSync(fullPath)) {
                const content = readFileSync(fullPath, "utf-8")
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
          // Record lastValidated per-file for future hash checks (fix-new-file-gate: mapa + fallback legacy)
          try {
            const st = readState(directory)
            if (st) {
              const fp = fastFingerprint(resolve(directory, targetPath))
              const prev: any = (st as any).lastValidated
              let byFile: Record<string, any> = {}
              if (prev) {
                if (prev.byFile && typeof prev.byFile === 'object') byFile = { ...prev.byFile }
                else if (prev.filePath)
                  byFile[prev.filePath] = { hash: prev.hash ?? null, ts: prev.ts ?? 0, mode: prev.mode ?? 'replace' }
              }
              const isCreate = oldString.length === 0
              byFile[targetPath] = { hash: fp, ts: Date.now(), mode: isCreate ? 'create' : 'replace' }
              ;(st as any).lastValidated = {
                byFile,
                filePath: targetPath,
                hash: fp,
                ts: Date.now(),
                mode: isCreate ? 'create' : 'replace',
              }
              // FIX multi-sesión: persistir lastValidated. Antes se mutaba un objeto
              // local y se descartaba → complete_task leía un lastValidated viejo
              // desde disco → CONFLICT → las tareas quedaban pending y el cierre
              // (implementation_complete) se bloqueaba.
              // `["lastValidated"]` = se escribe SOLO esa clave sobre el estado
              // fresco que se re-lee bajo el lock compartido con el MCP.
              persistState(directory, st, ["lastValidated"])
            }
          } catch {}
        }
      }
    })

    await ctx.tool.hook("execute.after", (event) => {
      // Track discovery hit to allow subsequent Reads
      const tool: string = event.tool as string
      const sessionId: string = (event.sessionID ?? "default") as string
      // (fix-codegraph-gate) Evidencia REAL de discovery: un `codegraph_explore` completado en ESTA
      // sesión abre el gate de lecturas de código. Se marca aunque el resultado venga vacío, a
      // propósito: "CodeGraph no tiene este archivo en su índice" es justamente el caso donde el
      // Read TIENE que poder pasar si hubo `codegraph_explore`.
      if (marksDiscovery(tool)) {
        try {
          if (event.status === "completed") discoveryHitByRequest.set(sessionId, true)
        } catch {}
      }
      // Track Engram hit (mem_search / mem_context / dedup) para soft gate 1.6
      if (tool.includes("engram_mem_search") || tool.includes("engram_mem_context") || tool.includes("mem_search") || tool.includes("mem_context") || tool.includes("engram_mem_")) {
        engramHitBySession.set(sessionId, true)
      }
      // test-verification-execution: evidencia para tasks `test:`.
      // `status` miente con exit != 0 (ver shellEvidence): sólo se registra con exit numérico.
      // D10 respectado: NO cada shell persiste (git/ls/builds no tienen valor de evidencia y
      // cada persist cuesta lock + re-read + write + 3 renames de backup). Se persisten sólo
      // las corridas cuyo comando matchea un `test:` declarado en taskVerifications — que son
      // las ÚNICAS que complete_task / verifyIntegrity consultan via findTestEvidence.
      // Tradeoff fail-closed: si taskVerifications aún no llegó al state cuando se corre el
      // test, la evidencia no se registra → complete_task pide re-correr (razón explícita).
      try {
        const ev = shellEvidence(event as any)
        // Un shell que escribe (exit 0) también invalida evidencia de test:
        // si no, `sed -i` mutaría el código sin avanzar el timestamp.
        const mutating =
          (isMutatingTool(tool) && event.status === "completed") ||
          (!!ev && ev.exit === 0 && isShellMutation(ev.cmd))
        const isTestRun = !!ev && testVerifyCommands(readState(directory)).has(ev.cmd)
        if (isTestRun || mutating) {
          const s = readState(directory)
          if (s) {
            const owned: string[] = []
            if (ev && isTestRun) {
              const prev = Array.isArray((s as any).shellRuns) ? (s as any).shellRuns : []
              ;(s as any).shellRuns = [...prev, ev].slice(-25)
              owned.push("shellRuns")
            }
            if (mutating) {
              ;(s as any).lastMutationTs = Date.now()
              owned.push("lastMutationTs")
            }
            if (owned.length > 0) persistState(directory, s, owned)
          }
        }
      } catch {}
      // Heartbeat: single-writer — plugin memo, no persist cada tool (D10)
      try {
        const s = readState(directory)
        if (s) {
          const now = Date.now()
          // Single-writer: solo persiste si OSTACKY_PLUGIN_PERSIST=1 o idle>30s o state cambió
          const shouldPersist = process.env.OSTACKY_PLUGIN_PERSIST === "1" || (now - (s.lastHeartbeat || 0) > 30000)
          if (shouldPersist) {
            s.lastHeartbeat = now
            try { persistState(directory, s, ["lastHeartbeat"]) } catch {}
          }
        }
      } catch {}
    })

    const emptySchema = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    } as const

    // ── Observable tools (MCP thin replacement) ──
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "ostacky_get_state",
        description: "Get Ostacky controller state (plugin, no MCP needed)",
        input: emptySchema,
        execute: async () => {
          const state = readState(directory)
          if (!state) return jsonContent({ error: "no state", state: "UNKNOWN", revision: 0 })
          return jsonContent({ state: state.state, revision: state.revision, requestId: state.requestId, degraded: !!state.degraded, level: state.level, routeChoice: state.routeChoice })
        },
      })
      editor.add({
        name: "ostacky_get_audit",
        description: "Get audit trail (plugin)",
        input: emptySchema,
        execute: async () => {
          const state = readState(directory)
          return jsonContent({ audit: state?.audit ?? [], revision: state?.revision ?? 0 })
        },
      })
      editor.add({
        name: "ostacky_get_metrics",
        description: "Get controller metrics (plugin)",
        input: emptySchema,
        execute: async () => {
          const state = readState(directory)
          return jsonContent({
            cacheHitCount: state?.cacheHitCount ?? 0,
            discoveryCacheHitCount: state?.discoveryCacheHitCount ?? 0,
            tokenSavingEstimate: state?.tokenSavingEstimate ?? 0,
            stateCheckCount: state?.stateCheckCount ?? 0,
            codegraphBypassCount: state?.codegraphBypassCount ?? 0,
            engramBypassCount: state?.engramBypassCount ?? 0,
            revision: state?.revision ?? 0,
          })
        },
      })
      editor.add({
        name: "ostacky_get_handoff",
        description: "Get last handoff (plugin)",
        input: emptySchema,
        execute: async () => {
          const state = readState(directory)
          // also check compaction fallback
          try {
            const fallback = join(dirname(getStatePath(directory)), ".ostacky-handoff-compaction.json")
            if (existsSync(fallback)) {
              const raw = readFileSync(fallback, "utf-8")
              const data = JSON.parse(raw)
              if (data && !state?.lastHandoff) return jsonContent(data)
            }
          } catch {}
          return jsonContent(state?.lastHandoff ?? null)
        },
      })
      editor.add({
        name: "ostacky_get_available_transitions",
        description: "Get available transitions from current state",
        input: emptySchema,
        execute: async () => {
          const state = readState(directory)
          const cur = state?.state ?? "INTERPRETATION_PENDING"
          const trans = TRANSITIONS[cur] ?? []
          return jsonContent({ currentState: cur, transitions: trans })
        },
      })
      // Compatibility for old MCP calls that expect deprecated response
      editor.add({
        name: "ostacky_check_pending_state",
        description: "[deprecated] plugin enforces — use tool before hook",
        input: emptySchema,
        execute: async () => {
          return jsonContent({ deprecated: true, hint: "plugin enforces", allowed: true })
        },
      })
      editor.add({
        name: "ostacky_validate_edit",
        description: "[deprecated] plugin enforces validate_edit in-process",
        input: emptySchema,
        execute: async () => {
          return jsonContent({ deprecated: true, hint: "plugin enforces" })
        },
      })
    })

    const eventController = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: eventController.signal })) {
        if (event.type === "session.deleted") {
          const sid = event.data.sessionID as string
          if (sid) {
            trivialBySession.delete(sid)
            discoveryHitByRequest.delete(sid)
            engramHitBySession.delete(sid)
          }
        }
      }
    })()

    await ctx.session.hook("compaction", (event) => {
      try {
        const statePath = getStatePath(directory)
        const dir = dirname(statePath)
        try { mkdirSync(dir, { recursive: true }) } catch {}
        const fallbackPath = join(dir, ".ostacky-handoff-compaction.json")
        const contextSnippet = (() => {
          try {
            return JSON.stringify(event.messages.slice(0, 2)).slice(0, 800)
          } catch { return "" }
        })()
        const payload = {
          summary: `Compaction fallback for session ${event.sessionID ?? "unknown"} — plugin`,
          nextSteps: [] as string[],
          pendingTasks: [] as string[],
          ts: Date.now(),
          contextSnippet,
        }
        const tmp = `${fallbackPath}.tmp.${process.pid}`
        writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8")
        renameSync(tmp, fallbackPath)
      } catch {}
    })

    return () => {
      try { if (pingInterval) clearInterval(pingInterval) } catch {}
      pingInterval = null
      eventController.abort()
    }
  },
}
