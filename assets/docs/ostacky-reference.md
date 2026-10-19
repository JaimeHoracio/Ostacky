# Ostacky Reference — Detalle no crítico para prompt

Este archivo NO se inyecta en el prompt. Se lee on-demand con `Read assets/docs/ostacky-reference.md` cuando el LLM necesita detalle exacto.

## TRANSITIONS (controller)

```
INTERPRETATION_PENDING: request_clarification→CLARIFICATION_PENDING, proceed_to_discovery→DISCOVERY, record_discovery→ROUTE_DECISION_PENDING, block→BLOCKED
CLARIFICATION_PENDING: record_clarification→DISCOVERY, block→BLOCKED, abandon→BLOCKED
DISCOVERY: record_discovery→ROUTE_DECISION_PENDING, block→BLOCKED, abandon→BLOCKED
ROUTE_DECISION_PENDING: consume_route_decision(SPEC→SPECIFICATION, DIRECT→EXECUTION_ANALYSIS), block→BLOCKED
SPECIFICATION: spec_complete→EXECUTION_ANALYSIS, block→BLOCKED
EXECUTION_ANALYSIS: record_execution_analysis→EXECUTION_DECISION_PENDING, block→BLOCKED
EXECUTION_DECISION_PENDING: consume_execution_decision(INLINE→EXECUTING_INLINE, SUBAGENT→EXECUTING_SUBAGENTS), block→BLOCKED
EXECUTING_INLINE/SUBAGENTS: implementation_complete→SYNC, block→BLOCKED (block preserva tasks, replan prohibido)
SYNC: sync_complete→DONE
BLOCKED: replan→INTERPRETATION_PENDING, abandon→DONE
```

`proceed_to_route` deprecated → no-op alias retorna `{deprecated:true, state:"ROUTE_DECISION_PENDING"}` (compat).

## Retry / Timeouts

| Tool | Timeout | Reintentos | Fallback |
|------|---------|------------|----------|
| codegraph_* | 10s | 1 | Engram → Read+Glob |
| controller_* | 5s | 1 | degraded |
| engram_* | 5s | 1 | sin memoria |

## Discovery

- Sin cache de archivo: discovery = `codegraph_explore` + `mem_search`; el reuso es del output ya presente en el contexto del request. `src/discovery-cache.ts` y `src/cache-codegraph.ts` se retiraron (change `remove-discovery-cache-phantom`).
- `OSTACKY_CACHE_DISABLE` ya no existe: no hay cache filesystem que desactivar.
- Los contadores `cacheHitCount`/`tokenSavingEstimate` quedan en `get_metrics` por compatibilidad, en 0: nada los incrementa.
## Metrics (get_metrics)

`revision, state, degraded, taskCounts{completed,pending,total,expected}, expectedTaskCount, auditSize, stateFileSize, diskFreeMB, uptimeMs, stateOversizedCount, codegraphBypassCount, degradedEditsCount, cacheHitCount, cacheMissCount, tokenSavingEstimate, sensitiveAccess, subagentFailedCount, discoveryCacheHitCount, redundantCallCount, cacheMissWithoutPutCount, stateCheckCount, toolCallCount`

## BASH_SENSITIVE_RE

```js
/(?:^|[^a-zA-Z0-9_.-])(\.env(\b|[_.-])|\.secrets\b|\.pem\b|\.key\b|credentials\.json|\.aws\b|\.ssh\b|\.npmrc\b)/i
```
Allowlist: `.env.example/.template/.sample` nunca bloquea. `extractPathsFromBash` tokeniza `| ; && || > >> <`.

## validate_edit contrato

`content` requerido salvo `content:"hash:"+fastFingerprint` cuando `lastValidated.filePath==filePath && fingerprint==hash` y fingerprint coincide con disco → EDITABLE sin body. Hash stale → CONFLICT `stale fingerprint`.

## refresh_fingerprint (revalidación sin churn)

Tras refino post-complete (archivo ya correcto, sin edición pendiente): `refresh_fingerprint({filePath})` o `refresh_fingerprint({taskId})` re-sincroniza `tasks[].fileHash` + `fileFingerprints` con disco, sin `oldString/newString`. Vale para SPEC y DIRECT, en `EXECUTING_INLINE`, `EXECUTING_SUBAGENTS` y `SPECIFICATION`. Luego `verifyIntegrity.ok` → `implementation_complete` sin `force`.

## Enforcement (plugin)

El plugin hace cumplir `PENDING` en `ctx.tool.hook("execute.before")`; `lastCheck={revision, result}` cachea ALLOW por revisión, revalida si cambia o >5 tools; `BLOCKED` nunca cacheado. Métricas `stateCheckCount` cuentan checks del plugin (no del LLM).

## Gate de CodeGraph (alcance real)

Cubre `read`/`grep`/`glob`/`read_mcp_resource` y **`shell`** cuando el comando revela contenido (`cat`, `head`, `tail`, `sed` sin `-i`, `grep`, `rg`, `awk`, `diff`…). Predicado puro: `shellReadTargets(command)` devuelve los paths de código **revelados**, no los mencionados — `bun test x.ts`, `tsc src/x.ts` y `git diff` pasan.

**Fail-open:** redirección (`>`/`>>`), `sed -i` y verbo fuera de la allowlist → se permite. `read` falla cerrado porque es inequívoco; `shell` no, y un falso positivo rompe tests/builds sin escape hatch.

**No es un sandbox.** Bypass residual por diseño: `git show`, `python -c`, `node -e`, `find -exec`, `xargs`, `base64`. El objetivo es quitar el bypass casual (`cat src/x.ts`), no probar imposibilidad.

`execute` (Code Mode) **no** se gatea: su catálogo no expone `read`/`grep`/`shell` ni filesystem. Si una versión futura lo expone, el gate debe extenderse.

## Evidencia de ejecución (`test:`)

`test:<cmd>` no se puede verificar sin ejecutar. El plugin observa cada `shell` y registra `{cmd, exit, ts}` (últimas 25) en el state compartido; `complete_task` exige comando exacto (trim), `exit 0` y `ts` posterior a `lastMutationTs` (que avanza en cada `edit`/`write`/`patch` completado y en cada `shell` que escribe con exit 0: `cp`, `mv`, `rm`, `sed -i`, `tee`, redirección). `verifyIntegrity` re-verifica en el cierre: una edición posterior vence la evidencia y bloquea.

**No se usa `status`:** en OpenCode 2.0.32, `sh -c 'exit 3'` llega con `status: "completed"` y `result.metadata.status: "completed"`. El único campo veraz es `result.metadata.exit`.

**Límites declarados:** un test débil pasa (semántica, no mecánica); sin el plugin no hay `shellRuns` y `test:` falla cerrado.

## Tiered Behaviour

`isTrivial(msg,state) = state==DONE && msg.trim().length<30 && /^(hola|hey|gracias|buenas|hi|hello)\b/i.test(msg) && !/(necesito|quiero|agregá|fix|bug|feature|auth|spec|implementar)/i.test(msg)`

- **Trivial + DONE**: `output.system[0]` permanece `FULL` diet cacheable (10% hit), plugin añade suffix hint `[PLUGIN HINT: Saludo trivial — responde breve sin tools]` y bloquea `mem_context`/`codegraph_*` con `SKIP`. Solo Engram pointer 1 línea, no `MEMORY_INSTRUCTIONS`.
- **TIER1** (0/0+1 con intent): hint `TIER1` en suffix, `FULL` sigue cacheado, `DIRECT` sin `Alternatives`.
- **FULL** (1+): sin hint, `FULL` con `MEMORY_INSTRUCTIONS` lazy (solo si `!isTrivial` o nudge >15m).

Principio: **eficacia > recorte** — si recorte rompiera caché y saliera más caro, se prioriza mantener `FULL` estable.

## Security single-source

`src/security.ts` único origen de `SENSITIVE_DEFAULT`/`BASH_SENSITIVE_RE`/`isSensitive`/`extractPathsFromBash` (import `node:crypto`); mirrors generados en `assets/plugins/ostacky-controller/security.ts` (solo Sensitive guard, sin crypto) y `assets/mcp/ostacky-controller/security.js` vía `bun run scripts/sync-controller-core.ts`. `assets/plugins/ostacky-controller/index.ts` importa de `./security.ts` self-contained (no `../../src`). `BASH_SENSITIVE_RE` arriba. `OSTACKY_SENSITIVE_PATTERNS` override.

## Tiered single-source

`src/tiered.ts` único origen de `isTrivial(msg,state)` + `getControllerState(dir)`. `index.ts` importa de `./tiered.ts` mirror (generado vía `sync-controller-core.ts`), `engram.ts` inlined (misma regex, evita import dinámico). No duplicar regex. Ver `assets/plugins/ostacky-controller/` y `assets/plugins/engram.ts`.

## Controller single-source

`src/controller-core.ts` CANÓNICO para `STATES/TRANSITIONS/DEFAULT_STATE`; mirrors generados en `assets/plugins/ostacky-controller/controller-core.ts` (TS) y `assets/mcp/ostacky-controller/controller-core.js` (JS strippado) vía `bun run scripts/sync-controller-core.ts` (prebuild). No editar mirrors. `index.ts` importa de `./controller-core.ts` self-contained. Import siempre `./security.ts` (el server V2 no resuelve `.js→.ts`).

## Prompt-efficiency

- `ostacky.md` 109→72 líneas (diet estable cacheable). Tiered vía suffix, no reemplazo `system[0]`.
- `controller` descriptions <150 chars
- `MEMORY_INSTRUCTIONS` lazy: siempre pointer (~1 línea) en `system.transform`; full vive en `assets/docs/engram-protocol.md` on-demand via `Read` (ahorro ~1.2k en FULL, trivial ya era pointer)

## Propose Flow (1+)

`openspec-propose` SHALL Paso 0: `codegraph_codegraph_explore` + `engram_mem_search` sobre el área (si no se hicieron ya en el request) **antes** de `openspec new`. Citá símbolos existentes en `proposal/design`; sin esto dispara `WARN:codegraphBypass` y `design.md` alucina API. Ver `assets/skills/openspec-propose/SKILL.md: Paso 0` y `brainstorming` (router por nivel: `brainstorming` decide 0/0+1/1+, `openspec-explore` es stance sin nivel).
