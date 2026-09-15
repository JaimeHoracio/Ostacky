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

## Cache

- `src/cache-codegraph.ts`: `.opencode/cache/codegraph/<sha256(query)>.json` con `{ts, result, gitHead, gitDiffHash}`, TTL 1h, `OSTACKY_CACHE_DISABLE=1` bypass, LRU 50MB, invalidación `git diff --name-only` + `git status --porcelain --untracked-files=all` (hash combinado).
- `src/discovery-cache.ts`: `.opencode/cache/codegraph/discovery-<sha256>.json` con `{codegraph, engramHits, gitDiffHash, gitHead, ts, query}`, mismo TTL/LRU. `getDiscoverySnapshot` → hit reusar sin llamar tools; miss → SHALL `putDiscoverySnapshot` antes de `record_discovery` (auditable `WARN:cache_miss_without_put`).
- `record_cache_hit/miss` internos: `cache-codegraph.ts` hace write directo a `ostacky-state.json` incrementando `cacheHitCount/tokenSavingEstimate` sin tool LLM.

## Metrics (get_metrics)

`revision, state, degraded, taskCounts{completed,pending,total,expected}, expectedTaskCount, auditSize, stateFileSize, diskFreeMB, uptimeMs, stateOversizedCount, codegraphBypassCount, degradedEditsCount, cacheHitCount, cacheMissCount, tokenSavingEstimate, sensitiveAccess, subagentFailedCount, discoveryCacheHitCount, redundantCallCount, cacheMissWithoutPutCount, stateCheckCount, toolCallCount`

## BASH_SENSITIVE_RE

```js
/(?:^|[^a-zA-Z0-9_.-])(\.env(\b|[_.-])|\.secrets\b|\.pem\b|\.key\b|credentials\.json|\.aws\b|\.ssh\b|\.npmrc\b)/i
```
Allowlist: `.env.example/.template/.sample` nunca bloquea. `extractPathsFromBash` tokeniza `| ; && || > >> <`.

## validate_edit contrato

`content` requerido salvo `content:"hash:"+fastFingerprint` cuando `lastValidated.filePath==filePath && fingerprint==hash` y fingerprint coincide con disco → EDITABLE sin body. Hash stale → CONFLICT `stale fingerprint`.

## Enforcement (plugin)

El plugin hace cumplir `PENDING` en `tool.execute.before`; `lastCheck={revision, result}` cachea ALLOW por revisión, revalida si cambia o >5 tools; `BLOCKED` nunca cacheado. Métricas `stateCheckCount` cuentan checks del plugin (no del LLM).

## Tiered Behaviour

`isTrivial(msg,state) = state==DONE && msg.trim().length<30 && /^(hola|hey|gracias|buenas|hi|hello)\b/i.test(msg) && !/(necesito|quiero|agregá|fix|bug|feature|auth|spec|implementar)/i.test(msg)`

- **Trivial + DONE**: `output.system[0]` permanece `FULL` diet cacheable (10% hit), plugin añade suffix hint `[PLUGIN HINT: Saludo trivial — responde breve sin tools]` y bloquea `mem_context`/`codegraph_*` con `SKIP`. Solo Engram pointer 1 línea, no `MEMORY_INSTRUCTIONS`.
- **TIER1** (0/0+1 con intent): hint `TIER1` en suffix, `FULL` sigue cacheado, `DIRECT` sin `Alternatives`.
- **FULL** (1+): sin hint, `FULL` con `MEMORY_INSTRUCTIONS` lazy (solo si `!isTrivial` o nudge >15m).

Principio: **eficacia > recorte** — si recorte rompiera caché y saliera más caro, se prioriza mantener `FULL` estable.

## Security single-source

`src/security.ts` único origen de `SENSITIVE_DEFAULT`/`BASH_SENSITIVE_RE`/`isSensitive`/`extractPathsFromBash`; plugin y guard importan, no copian. `BASH_SENSITIVE_RE` arriba. `OSTACKY_SENSITIVE_PATTERNS` override.

## Tiered single-source

`src/tiered.ts` único origen de `isTrivial(msg,state)` + `getControllerState(dir)`. Ambos plugins importan lógica idéntica, no duplican regex. Ver `assets/plugins/ostacky-plugin.ts` y `assets/plugins/engram.ts`.

## Prompt-efficiency

- `ostacky.md` 109→72 líneas (diet estable cacheable). Tiered vía suffix, no reemplazo `system[0]`.
- `controller` descriptions <150 chars
- `MEMORY_INSTRUCTIONS` lazy: siempre pointer (~1 línea) en `system.transform`; full vive en `assets/docs/engram-protocol.md` on-demand via `Read` (ahorro ~1.2k en FULL, trivial ya era pointer)
