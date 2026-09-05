---
name: graceful-degradation
description: "Handle situations where multiple tools (CodeGraph, Engram MCP, Controller) are unavailable. Provides a systematic approach to continue working with reduced capabilities."
---

# Graceful Degradation

When critical tools are unavailable, this skill provides a systematic approach to continue working with reduced capabilities instead of failing completely.

**Follow Core Instructions** — `ostacky.md` Core Instructions section for CodeGraph and Engram usage patterns.

**IMPORTANT:** Engram is an **MCP server**, not a skill. Tools `engram_mem_save`, `engram_mem_search`, `engram_mem_context` are MCP tools. Do NOT use `skill("engram")` — it doesn't exist.

---

## Tool Availability Matrix

| Tool | Type | Fallback Chain | Impact |
|------|------|----------------|--------|
| CodeGraph | MCP server | Engram → Read + Glob | No structural analysis, manual exploration |
| Engram | MCP server | Continue without memory | No persistence across sessions |
| Controller | MCP server | Inline validation + manual state | No state machine, no edit validation |

## Detection

After health check pre-vuelo, classify the situation:

### All Tools Available
Normal operation. No degradation needed.

### Partial Degradation (1-2 tools down)
Continue with available tools. Report to user.

### Complete Degradation (All tools down)
Switch to basic mode with manual workflows.

## Degraded Workflows

### Without CodeGraph

**Available alternatives:**
1. **Engram** — Check if previous analysis exists for the area
2. **Read + Glob** — Manual file exploration

**Workflow:**
```
1. engram_mem_search for related analysis (if Engram available)
2. Use Glob to find relevant files: **/*.ts, src/**/*.ts
3. Read files manually to understand structure
4. Proceed with caution — no blast radius analysis
```

**Limitations:**
- No call path analysis
- No blast radius calculation
- No symbol search
- Higher risk of missing dependencies

### Without Engram

**Available alternatives:**
1. **OpenSpec** — Check for active changes with proposals/designs
2. **Filesystem** — Check for previous analysis docs

**Workflow:**
```
1. Check openspec/changes/ for active change artifacts
2. Check docs/superpowers/specs/ for design documents
3. Proceed without session memory
4. At session end, document key decisions in a summary
```

**Limitations:**
- No cross-session memory
- No decision history
- Risk of repeating previous mistakes

### Without Controller

**Available alternatives:**
1. **Inline validation** — Manual edit validation
2. **Manual state tracking** — Track progress in conversation

**Workflow:**
```
1. For each edit:
   - Read file fresh
   - Verify oldString ≠ newString
   - Verify oldString appears exactly once
   - Execute edit
2. Track completed tasks mentally or in conversation
3. No automatic state persistence
```

**IMPORTANT — No check_pending_state:**
When controller is unavailable, `check_pending_state` does NOT exist.
- Do NOT try to call it — it will fail
- The enforcement rule in Core Instructions applies ONLY when controller is available
- In degraded mode, rely on the "Una pregunta por turno" rule directly

**Hard gate de credenciales (hardening-v2 P0):**
Incluso en degraded, el guard de credenciales sigue activo (hard gate incluso en degraded). `bash`/`read`/`write`/`edit` sobre `.env`, `.secrets`, `*.pem`, `*.key`, `.aws`, `.ssh`, `credentials.json`, `.npmrc` sin `allowedFiles` sigue lanzando `BLOCKED` — nunca uses `bash cat .env` sin `check_file_access → consume ALLOW` auditado (ver `assets/agents/ostacky.md` §Credential Guard).

**Limitations:**
- No automatic edit validation
- No task completion tracking
- No state persistence across crashes
- No pending state enforcement (check_pending_state unavailable)

## Communication Protocol

### Status Report Format

When degradation is detected, report to user:

```
⚠️ [Tool] no disponible — usando fallback: [fallback]

Herramientas disponibles:
✅ [Tool1] — [status]
❌ [Tool2] — [fallback being used]
⚠️ [Tool3] — [degraded mode]

¿Continuar con funcionalidad reducida?
```

### Example Reports

**CodeGraph down:**
```
⚠️ CodeGraph no disponible — usando fallback: Engram → Read

Herramientas disponibles:
✅ Controller — ping OK
❌ CodeGraph — timeout 10s
✅ Engram — disponible

¿Continuar con lectura manual de archivos?
```

**All tools down:**
```
🔴 Stack de herramientas no disponible — modo básico activado

Herramientas disponibles:
❌ Controller — no responde
❌ CodeGraph — no instalado
❌ Engram — timeout 5s

Modo básico: sin validación de edits, sin memoria persistente, sin análisis estructural.
¿Continuar o cancelar?
```

## Handoff Fallback (compaction)

Si el controller hizo `set_handoff` o el plugin escribió el fallback `dirname(OSTACKY_STATE_PATH)/.ostacky-handoff-compaction.json` antes de compaction, el próximo agente **debe** llamar `get_handoff` al inicio. `get_handoff` primero chequea `lastHandoff` en memoria y si es `null` lee el archivo fallback (mismo ancla que el writer). `clear_handoff` borra ambos. `cleanupTmpFiles` solo borra ese archivo si `ts >24h`. Ver `assets/plugins/engram.ts:experimental.session.compacting` y `assets/mcp/ostacky-controller/index.js:get_handoff`.

## Recovery After Degradation

When a tool becomes available again during the session:

1. **Detect:** Health check succeeds on next call
2. **Report:** "✅ [Tool] disponible nuevamente"
3. **Resume:** Switch back to normal workflow
4. **Catch up:** Use the tool to verify recent work

## Health via get_metrics y doctor (6.2)

- **Con Controller:** usar `get_metrics` como health — expone `degraded`, `diskFreeMB`, `auditSize`, `stateFileSize`, `codegraphBypassCount`, `stateOversizedCount`, `degradedEditsCount`, `sensitiveAccess`. Si `diskFreeMB<100` → ⚠️ Disco casi lleno; si `stateOversizedCount>0` → snapshots perdidos.
- **Sin Controller:** fallback a `ostacky doctor` (lee `.opencode/ostacky-state.json` sin MCP, verifica locks, tamaños, audit, binarios y `manifest.json` hashes). `doctor` es el fallback a `check:skills` cuando MCP caído.
- **Sin CodeGraph:** `get_metrics.codegraphBypassCount` incrementa cuando `record_discovery` sin `symbols` y no degraded; `get_audit` marca `inefficient: codegraph bypass` para review.
- **Sin Engram:** continuar sin memoria; `doctor` no requiere Engram.

No usar `skill("engram")` — Engram es MCP server, no skill. Usar `engram_mem_*` tools.

## Guardrails

### During Degradation

- **Never skip validation** — Use inline validation when controller is down
- **Never assume structure** — Read files even if you think you know them
- **Document decisions** — Write down key choices since Engram may be down
- **Report limitations** — User must know what's working and what's not

### When Choosing to Continue

Ask yourself:
1. Can I safely complete this task without the missing tool?
2. What's the worst case if I proceed without it?
3. Is the user aware of the limitations?

If unsure → ask the user.

### When to Stop

- All critical tools are down AND the task requires them
- The task is high-risk without structural analysis (CodeGraph)
- The user requests to stop

## Integration

This skill is loaded automatically when the agent detects tool failures during the health check pre-vuelo.

It does NOT replace other skills — it provides degraded workflows for them.

## Examples

### Example 1: CodeGraph fails, others work

```
Agent: ⚠️ CodeGraph no disponible (timeout 10s).

Voy a usar Engram para buscar análisis previos y luego leer archivos manualmente.

¿Continuar con esta aproximación?

User: Sí

Agent: [Uses engram_mem_search to find related analysis]
       [Uses Glob to find relevant files]
       [Reads files manually]
       [Proceeds with task]
```

### Example 2: Controller fails

```
Agent: ⚠️ Controller no disponible — operando con validación inline.

Cada edit será validado manualmente:
- oldString ≠ newString
- oldString aparece exactamente una vez

¿Continuar?

User: Sí

Agent: [Reads file fresh]
       [Validates oldString manually]
       [Executes edit]
       [Reports completion]
```
