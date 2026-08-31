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

## Env sensibles (hardening-v2)

- `OSTACKY_SENSITIVE_PATTERNS` — overridea `SENSITIVE_DEFAULT` (`**/.env*`, `**/.secrets/**`, `**/*.pem`, `**/*.key`, `**/.aws/**`, `**/.ssh/**`, `**/credentials.json`, `**/.npmrc`). Ejemplo: `OSTACKY_SENSITIVE_PATTERNS="**/.env*,**/.secrets/**" bunx ostacky doctor`. Allowlist `.env.example/.template/.sample` nunca bloquea. Fuente única: `src/security.ts` (`SENSITIVE_DEFAULT`, `isSensitive`, `BASH_SENSITIVE_RE`, `extractPathsFromBash`) — guard y controller usan misma lógica.
- `OSTACKY_CACHE_DISABLE=1` — desactiva cache filesystem de CodeGraph (`.opencode/cache/codegraph/`) para CI.
- `OSTACKY_SENSITIVE_PATTERNS` y `OSTACKY_CACHE_DISABLE` se documentan en `README.md` y `doctor`.

## Doctor

`bunx ostacky doctor` valida `sensitivePatterns`, `allowedFiles`/`deniedFiles`, `cache` health (<50MB, LRU) y `src/security.ts` como source-of-truth.
