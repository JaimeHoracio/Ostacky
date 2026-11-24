# AGENTS

Ver `assets/agents/ostacky.md` para instrucciones completas del orquestador Ostacky.

## CodeGraph — corrección de prefijo (hardening-v2)

Los tools de CodeGraph se registran con prefijo `codegraph_` y OpenCode agrega otro `codegraph_`. **Los nombres reales son `codegraph_codegraph_*`** (doble prefix), consistente con `assets/agents/ostacky.md`:

- `codegraph_codegraph_explore`
- `codegraph_codegraph_node`
- `codegraph_codegraph_search`
- `codegraph_codegraph_callers`
- `codegraph_codegraph_callees`
- `codegraph_codegraph_impact`
- `codegraph_codegraph_files`
- `codegraph_codegraph_status`

No usar `codegraph_explore` (single prefix) — ese nombre no existe en MCP (ver `AGENTS.md` anterior con drift).

## Orden de herramientas de discovery (igual que `assets/agents/ostacky.md`)

1. **Engram** — `mem_context` al inicio del discovery; `mem_search` antes de decidir. Una llamada, timeout 10s. Si `degraded`, timeout o error → avisar "sin memoria" y seguir. Exento si `isTrivial && DONE`.
2. **CodeGraph** — `codegraph_codegraph_explore` para símbolos, flujos e impacto (relaciones, dependencias, rutas de llamada). Timeout 10s. Si ya lo llamaste para el área en este request, reusar.
3. **Glob** — solo si no se conoce la ruta del archivo.
4. **Grep** — texto literal: configuración, mensajes, `OSTACKY_*`, TODO.
5. **Read** — comprobar el código fuente real antes de concluir cómo se comporta. Requiere un `codegraph_codegraph_explore` previo en el request.

**Fallback:** si CodeGraph da error, timeout o 0 símbolos útiles → Glob → Grep → Read (Engram ya se consultó en el paso 1). Si la sesión está degradada (`codegraph_explore` con error o timeout), el gate no exige discovery hasta el TTL (`OSTACKY_CODEGRAPH_DEGRADED_TTL_MIN`, 30 min). Ninguna herramienta puede dejar el flujo esperando: cada una tiene tope y camino alternativo.

## Env sensibles (hardening-v2)

- `OSTACKY_SENSITIVE_PATTERNS` — overridea `SENSITIVE_DEFAULT` (`**/.env*`, `**/.secrets/**`, `**/*.pem`, `**/*.key`, `**/.aws/**`, `**/.ssh/**`, `**/credentials.json`, `**/.npmrc`). Ejemplo: `OSTACKY_SENSITIVE_PATTERNS="**/.env*,**/.secrets/**" bunx ostacky doctor`. Allowlist `.env.example/.template/.sample` nunca bloquea. Fuente única: `src/security.ts` (`SENSITIVE_DEFAULT`, `isSensitive`, `BASH_SENSITIVE_RE`, `extractPathsFromBash`) — guard y controller usan misma lógica.
- `OSTACKY_SENSITIVE_PATTERNS` se documenta en `README.md` y `doctor`.

## Doctor

`bunx ostacky doctor` valida `sensitivePatterns`, `allowedFiles`/`deniedFiles`, `cache` health (<50MB, LRU) y `src/security.ts` como source-of-truth.
