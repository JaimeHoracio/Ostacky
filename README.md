# Ostacky

Ostacky es un **agent harness** para [OpenCode](https://opencode.ai): el orquestador que instalás en tu proyecto para que **4 herramientas** trabajen en sinergia sin pisarse y sin quemar tokens de más.

| Herramienta                                               | Rol                 | Responde                               |
| --------------------------------------------------------- | ------------------- | -------------------------------------- |
| [CodeGraph](https://github.com/colbymchenry/codegraph)    | Grafo de código     | DÓNDE está el código y a quién impacta |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec/)       | Especificaciones    | QUÉ hay que construir y POR QUÉ        |
| [Superpowers](https://github.com/obra/superpowers)        | Ejecución           | CÓMO se implementa, prueba y revisa    |
| [Engram](https://github.com/Gentleman-Programming/engram) | Memoria persistente | QUÉ aprendimos en sesiones anteriores  |

Ostacky las rutea según el **nivel de impacto del cambio** y **te pregunta antes de actuar**:

| Nivel   | Cuándo aplica                            | Flujo                                                                  |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **0**   | <5 líneas, 1 archivo, trivial            | CodeGraph → directo a inline                                           |
| **0+1** | 5-10 líneas, 1-2 archivos, sin API nueva | CodeGraph → vos elegís: spec o directo                                 |
| **1+**  | >10 líneas, API pública, refactors       | CodeGraph → OpenSpec → execution-mode-evaluation → subagentes o inline |

Antes de ejecutar te muestra qué tasks comparten archivos, así elegís el modo de ejecución con información en mano.

## Requisitos

- [Node.js](https://nodejs.org/) >= 20 (para `npx`) o [Bun](https://bun.sh/) >= 1.x (para `bunx` o desarrollo)
- [OpenCode](https://opencode.ai) instalado ([docs](https://opencode.ai/v2/docs)): `bun install -g --trust @opencode/cli` o `npm install -g @opencode/cli` (el `--trust` de Bun habilita el postinstall que elige tu binario nativo)
- Git recomendado: con git hay aislamiento por worktree; sin git Ostacky instala en el directorio actual con un aviso
- **WSL:** seguí las instrucciones de **Linux** — WSL corre un kernel Linux real, no uses los comandos de PowerShell aunque estés en Windows

## Instalación

No requiere instalación global ni clonar el repositorio:

```bash
npx ostacky          # menú interactivo (te pregunta el scope)
bunx ostacky         # lo mismo con Bun
```

### Local (default)

```bash
npx ostacky install                 # <proyecto>/.opencode (default)
npx ostacky install --scope local   # explícito
```

Instala el núcleo (agente, commands, skills, MCPs, plugins) más el stack de herramientas (CodeGraph, Engram) en `<proyecto>/.opencode`, y asegura `.gitignore` con `.opencode/tools/`, `.codegraph/`, `.opencode/cache/` y `ostacky-state.json*`.

### Global (opt-in)

```bash
npx ostacky --scope global           # menú interactivo global
npx ostacky install --scope global   # el mismo núcleo, sin el stack
```

Escribe el núcleo en el config dir global de OpenCode, sin tocar ningún proyecto:

| SO            | Dir global                                              |
| ------------- | ------------------------------------------------------- |
| Linux / macOS | `~/.config/opencode` (respeta `XDG_CONFIG_HOME`)        |
| Windows       | `%APPDATA%\opencode` (fallback: `~/.config/opencode`)   |
| WSL           | como Linux                                              |

La config global acepta `opencode.json` o `opencode.jsonc`. Si el proyecto define el mismo MCP, el del proyecto reemplaza al global (comportamiento v2); en skills con mismo ID gana la del proyecto.

> **Migración v1 → v2:** `npx ostacky` sin subcomando busca la última versión publicada y, si detecta v1 instalada, ofrece migrar (siempre con confirmación).

### Por qué el stack es local

Con `--scope global` el stack (CodeGraph, Engram) **se omite** — se instala por proyecto con `npx ostacky install-stack` dentro de cada repo. El motivo:

- **El índice `.codegraph/` describe UN repo.** Se crea con `codegraph init` en cada proyecto y un watcher lo mantiene al día. Un índice global mezclaría símbolos de proyectos distintos (dos `UserService` colisionarían), no podría seguir ramas ni worktrees, y cada consulta arrastraría contexto ajeno. Como `.git/`: el motor puede ser global, el dato es por proyecto.
- **El `ostacky-state.json` es por worktree.** Guarda fase, locks y auditoría del orquestador; aislado por worktree, varios agentes en paralelo no se pisan.
- **Los binarios SÍ podrían ser globales** — ambos proyectos lo soportan (`npm i -g @colbymchenry/codegraph`; Engram vía Homebrew o su `setup.sh`, con datos en `~/.engram`). Ostacky prefiere una copia local versionada junto al lockfile para instalaciones reproducibles sin depender de tu PATH. Si ya tenés `engram` global, Ostacky lo reutiliza.

## Primeros pasos

1. **Iniciá OpenCode:** `opencode` (terminal) u `opencode pair` (web: abrí el link de un solo uso o escaneá el QR).
2. **Elegí el agente:** `/agents` → `ostacky` (o Shift+Tab / Ctrl+X A).
3. Escribí tu mensaje en el chat. En OpenCode v2, `@` es solo para referenciar archivos, no agentes.

> Por defecto la web corre en `http://127.0.0.1:49374` solo en localhost. Docs: https://opencode.ai/v2/docs/cli/web

## Uso diario

```bash
npx ostacky add agent              # selector múltiple (indica instalados y versión)
npx ostacky add command
npx ostacky update                 # diff de versiones antes de confirmar
npx ostacky@latest update          # update con la última versión publicada del instalador
```

> `@latest` y `update` son cosas distintas: `@latest` es el tag de npm (qué instalador descargás), `update` es la acción (qué contenido actualizás según el lockfile).

```bash
npx ostacky uninstall                          # safe-delete en <proyecto>/.opencode
npx ostacky uninstall --scope global           # safe-delete global
npx ostacky uninstall agent <nombre>           # puntual (sin nombre → selector)
npx ostacky uninstall-stack                    # limpia config del stack del proyecto
npx ostacky --version  |  npx ostacky --help
```

**Safe-delete:** solo borra lo trackeado en `ostacky-lock.json` — nunca toca componentes tuyos. Muestra preview con `Scope: <ruta>` y pide confirmación. Los plugins que instaló Ostacky no están en el lockfile: se limpian por allowlist; los tuyos no se tocan.

## Qué se instala

Local (`<proyecto>/.opencode`) o global (mismo árbol bajo el dir global, sin stack):

```
.opencode/
├── agents/ostacky.md
├── commands/install-stack.md
│   └── opsx-sync.md
├── skills/                 ← brainstorming, tdd, review, execution-mode-evaluation,
│                              subagent-driven, dispatching-parallel-agents, openspec-* (3),
│                              receiving-code-review, using-git-worktrees,
│                              using-superpowers, writing-skills, graceful-degradation
├── plugins/
│   ├── ostacky-controller/ ← controller hard-gate (index.ts + core + security + tiered)
│   └── engram.ts           ← plugin Engram
├── mcp/
│   ├── ostacky-controller/ ← MCP thin (observabilidad)
│   └── openspec/
├── tools/                  ← SOLO local: codegraph/bin + engram/bin
├── cache/codegraph/        ← cache local de descargas
├── ostacky-state.json      ← SOLO local: estado aislado por worktree
└── ostacky-lock.json       ← versiones instaladas (agents, commands, skills, mcpServers)
```

`plugins/` y `tools/` **no** se trackean en el lockfile. Instalaciones viejas con archivos legacy sueltos (`ostacky-plugin.ts`, `ostacky-guard.ts`, `ostacky-controller.ts`) se limpian automáticamente.

```json
{
    "version": "0.10.1",
    "tag": "v0.10.1",
    "agents": { "ostacky": { "version": "0.10.1", "sha256": "…" } },
    "commands": { "install-stack": { … }, "opsx-sync": { … } },
    "skills": { "brainstorming": { … }, "…" : {} },
    "mcpServers": { "ostacky-controller": { … }, "openspec": { … } }
}
```

Versionado con checksums: sumá `ostacky-lock.json` a git para que el equipo instale exactamente las mismas versiones (mismo tag y mismos checksums).

## Comandos útiles

Engram y CodeGraph viven en `.opencode/tools/<herramienta>/bin/` y se exponen como MCP servers. Algunos comandos CLI:

| Comando                                                           | Qué hace                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `engram list-projects`                                            | Proyectos con memoria                                   |
| `engram clean-content --project <nombre>` \| `--all`              | Borra memoria de un proyecto / de todos                 |
| `engram --version`                                                | Versión instalada                                       |
| `codegraph init -i`                                               | Indexa el proyecto (crea `.codegraph/`)                 |
| `codegraph sync` / `codegraph status`                             | Sincroniza / muestra estado del índice                  |
| `codegraph install --target opencode --location local --yes`      | Recablea CodeGraph a OpenCode y genera AGENTS.md        |

## Troubleshooting

- **Instalé fuera del proyecto / sin git:** el log muestra `projectRoot` y `toolsDir` explícitos; si `toolsDir` apunta a tu home (ej. `C:\Users\...\.opencode\tools\codegraph`) y esperabas tu proyecto, corriste el comando fuera de un repo git. Hacé `cd` al proyecto y re-ejecutá.
- **El install global creó `.opencode/` local:** actualizá (`npx ostacky@latest`) y reinstalá — el menú interactivo ya propaga el scope y el stack se omite en global.
- **Windows `cmd.exe ... codegraph.cmd init -i` durante el install:** warning no fatal — el binario quedó, solo falta el índice. Reintentá con `npx ostacky install-stack --scope local` o corré `.opencode\tools\codegraph\bin\codegraph.exe init -i` dentro del proyecto.
- **¿Errores en el stack?** Elegí el agente `ostacky` y ejecutá `/install-stack` en el chat: regenera el stack sin salir de la sesión.

## Seguridad

- `opencode.jsonc` puede versionarse para compartir permisos y MCP de forma reproducible.
- Descargas por tags de GitHub (nunca `main`), validación anti path-traversal y checksums SHA-256 del manifest.
- Cache local en `.opencode/cache/<repo>/<tag>/<ruta>` con validación de integridad: si el hash cacheado coincide, no hay petición de red.
- Lectura/escritura de `*.env` y `.secret/**` bloqueadas con `deny` (la sesión sigue por `experimental.continue_loop_on_deny`).
- Patrones sensibles configurables: `OSTACKY_SENSITIVE_PATTERNS="**/.env*,**/.secrets/**" bunx ostacky doctor` (allowlist: `.env.example/.template/.sample`). Fuente única en `src/security.ts`; verificá con `npx ostacky doctor`.

## Licencia

MIT
