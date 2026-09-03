# Ostacky

Ostacky es un **agent harness** para [OpenCode](https://opencode.ai). No es solo un agente más: es el orquestador que instalás en tu proyecto para que **4 herramientas** trabajen en sinergia sin pisarse y sin quemar tokens de mas.

| Herramienta                                               | Rol                 | Define                                 |
| --------------------------------------------------------- | ------------------- | -------------------------------------- |
| [CodeGraph](https://github.com/colbymchenry/codegraph)    | Grafo de código     | DÓNDE está el código y a quién impacta |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec/)       | Especificaciones    | QUÉ hay que construir y POR QUÉ        |
| [Superpowers](https://github.com/obra/superpowers)        | Ejecución           | CÓMO se implementa, prueba y revisa    |
| [Engram](https://github.com/Gentleman-Programming/engram) | Memoria persistente | QUÉ aprendimos en sesiones anteriores  |

Ostacky las rutea según el **nivel de impacto del cambio** (Nivel 0, Nivel 0+1, Nivel 1+), priorizando siempre eficiencia de tokens y preguntándote antes de actuar. Para cambios grandes usa OpenSpec (spec-driven development); para cambios chicos ejecuta directo con Superpowers skills.

## Cómo empezar

Después de instalar Ostacky (con `npx ostacky install`), necesitás iniciar OpenCode para usarlo. Tenés dos formas:

### Terminal UI (TUI) — recomendado para daily driving

```bash
opencode
```

Abre la interfaz de terminal interactiva. **Para elegir el agente Ostacky: usá `Tab` para navegar entre agentes** en el panel lateral, o escribí `/agent Ostacky` en el chat.

### Web UI — para usar desde el navegador

```bash
opencode web --port 4096
```

Abre OpenCode en el navegador en `http://localhost:4096`. **Para elegir el agente Ostacky: abrí el combo/selector de agentes** en la barra superior y seleccioná "Ostacky". Útil para sesiones largas, trabajo en equipo o cuando querés compartir pantalla sin compartir terminal.

Opciones útiles:

| Comando                                         | Qué hace                                            |
| ----------------------------------------------- | --------------------------------------------------- |
| `opencode web`                                  | Puerto aleatorio, abre el navegador automáticamente |
| `opencode web --port 4096`                      | Puerto fijo                                         |
| `opencode web --hostname 0.0.0.0`               | Accesible desde la red local                        |
| `opencode web --mdns`                           | Descubrible como `opencode.local`                   |
| `OPENCODE_SERVER_PASSWORD=secreta opencode web` | Con autenticación HTTP Basic                        |
| `opencode attach http://localhost:4096`         | Conectar una terminal TUI a un servidor web activo  |

> 💡 Si no tenés OpenCode instalado aún: `curl -fsSL https://opencode.ai/install | bash`

## ¿Qué es?

`Ostacky` es el agente (`.opencode/agents/`) que se instala directamente desde GitHub Releases. Cada instalación queda registrada en un lockfile con versión y checksum, lo que permite actualizaciones controladas y reproducibles.

## Stack

Ostacky integra **4 herramientas** especializadas para que trabajen en conjunto sin pisarse:

### Cómo trabajan en sinergia

1. **CodeGraph** descubre el alcance del cambio sin escanear el repo entero (consulta `codegraph_explore`, `codegraph_impact`).
2. **OpenSpec** documenta requisitos, contratos y escenarios de aceptación (proposal → design → spec → tasks).
3. **Superpowers** ejecuta con TDD, testing automatizado y review (brainstorming → plans → tdd → review).
4. **Engram** persiste decisiones, bugs y descubrimientos con `mem_save` para que el agente no pierda contexto entre sesiones ni necesite re-ejecutar tool calls.

Ostacky decide **cuándo y cómo** usar cada herramienta según el **nivel de impacto** del cambio:

| Nivel   | Cuándo aplica                            | Flujo                                                                  |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **0**   | <5 líneas, 1 archivo, trivial            | CodeGraph → directo a inline                                           |
| **0+1** | 5-10 líneas, 1-2 archivos, sin API nueva | CodeGraph → usuario elige: spec o directo                              |
| **1+**  | >10 líneas, API pública, refactors       | CodeGraph → OpenSpec → execution-mode-evaluation → subagentes o inline |

Antes de ejecutar, Ostacky **muestra el análisis de archivos compartidos** (qué tasks tocan los mismos archivos) para que el usuario decida el modo de ejecución informado. Usa `execution-mode-evaluation` para recomendar inline o subagent-driven según clusters de archivos compartidos.

## ¿Para qué sirve?

- Instalar el agente `Ostacky` en cualquier proyecto con un solo comando.
- Mantener un registro de qué versión está instalada (`ostacky-lock.json`)
- Detectar y aplicar actualizaciones mostrando el diff de versiones antes de confirmar
- Evitar descargas repetidas gracias al cache local en `.opencode/cache/`
- Resolver tareas chicas sin overhead extra de coordinación.
- Ejecutar tareas independientes en paralelo con **subagentes** cuando no comparten archivos, o inline secuencial cuando se pisan.

## Requisitos

- [Node.js](https://nodejs.org/) >= 20 (para usar con `npx`)
- o [Bun](https://bun.sh/) >= 1.x (para usar con `bunx` o desarrollo)
- [OpenCode](https://opencode.ai) instalado en tu máquina
- **WSL:** Si usás Windows con WSL, seguí las instrucciones para **Linux** — WSL corre un kernel Linux real. No uses los comandos de PowerShell aunque estés en Windows.

## Uso rápido (para usuarios)

No requiere instalación global ni clonar el repositorio. Se usa directamente con `npx` o `bunx`:

```bash
npx ostacky
```

```bash
bunx ostacky
```

## Uso

### Menú interactivo

```bash
npx ostacky
```

Detecta automáticamente el directorio `.opencode/` del proyecto (o lo crea) y muestra un menú para elegir qué hacer.

### Instalar todo

```bash
npx ostacky install                 # local por defecto (pregunta si querés global)
npx ostacky install --scope local   # <proyecto>/.opencode
npx ostacky install --scope global  # ~/.config/opencode (XDG/APPDATA en Windows)
npx ostacky install --scope auto    # local si existe .opencode/.git, si no global
```

Descarga todos los agentes y commands definidos en el manifest y los escribe en `.opencode/` (scope `local`) o en `~/.config/opencode` (`global`). Además copia los plugins **Ostacky-owned** `ostacky-plugin.ts` + `engram.ts` en `.opencode/plugins/` (el legacy `ostacky-guard.ts` fue fusionado en `ostacky-plugin.ts` y ya no se instala; `ostacky-controller.ts` legacy se limpia automáticamente si quedó de una instalación previa).

> **Coherencia local/global:** aunque elijas `global`, los plugins y herramientas (`tools/` con CodeGraph/Engram) permanecen siempre en `<proyecto>/.opencode` local para el hard-gate por worktree. En global solo se escribe el scope global + un espejo local de plugins. Para stack completo por proyecto ejecutá `npx ostacky install --scope local` dentro de cada repo.

### Agregar agentes o commands individualmente

```bash
npx ostacky add agent
npx ostacky add command
```

Muestra un selector múltiple con los recursos disponibles. Indica si ya están instalados y en qué versión.

### Actualizar

```bash
npx ostacky update
```

Consulta la última GitHub Release, compara las versiones instaladas contra el manifest remoto y muestra el diff antes de confirmar:

```
Actualizaciones disponibles
  agente   ostacky             0.0.1 → 0.0.2
  command  install-stack    0.0.1 → 0.0.2

¿Aplicar 2 actualización(es)? › Sí / No
```

Solo descarga los items que cambiaron de versión.

### Desinstalar

```bash
npx ostacky uninstall                          # pregunta local vs global, luego qué borrar
npx ostacky uninstall --scope local            # fuerza scope local
npx ostacky uninstall --scope global           # fuerza scope global
npx ostacky uninstall --scope auto             # auto
```

**Safe-delete:** solo borra lo trackeado en `.opencode/ostacky-lock.json` (agentes, commands, skills, MCPs) — nunca toca componentes previos del usuario que no estén en el lockfile. Antes de borrar muestra preview con `Scope: <ruta>` + lista de paths y pide confirmación. Los plugins Ostacky-owned (`ostacky-plugin.ts`, `engram.ts` + legacy `ostacky-guard.ts`/`ostacky-controller.ts` si quedaron) se limpian automáticamente via allowlist, nunca se borran plugins custom.

> Si el lockfile no existe o está vacío → `No hay nada instalado.` y no borra nada.

#### Desinstalar un agente puntual

```bash
npx ostacky uninstall agent <nombre>           # también admite --scope local|global|auto
npx ostacky uninstall agent                    # sin nombre → selector de instalados
```

Por ejemplo:

```bash
npx ostacky uninstall agent ostacky
```

#### Desinstalar un command puntual

```bash
npx ostacky uninstall command <nombre>         # también admite --scope
npx ostacky uninstall command                  # sin nombre → selector
```

Por ejemplo:

```bash
npx ostacky uninstall command install-stack
```

Si no especificás el nombre, el CLI te muestra un selector con los items instalados para que elijas cuáles desinstalar (puede ser uno o varios).

#### Desinstalar todo el stack (tools + config)

```bash
npx ostacky uninstall-stack                    # pregunta scope, limpia mcp.codegraph/engram de opencode.json + .codegraph/ + .opencode/tools/
npx ostacky uninstall-stack --scope local
```

No toca binarios globales ni datos de Engram, solo la configuración del proyecto.

### Otros

```bash
npx ostacky --version   # muestra la versión del CLI
npx ostacky --help      # muestra la ayuda
```

## Estructura generada

Tras instalar (`--scope local`), el proyecto queda así:

```
.opencode/
├── agents/
│   └── ostacky.md
├── commands/
│   ├── install-stack.md
│   └── opsx-sync.md
├── skills/
│   ├── brainstorming/
│   ├── tdd/
│   ├── review/
│   ├── execution-mode-evaluation/
│   ├── subagent-driven-development/
│   ├── dispatching-parallel-agents/
│   ├── openspec-propose/
│   ├── openspec-apply-change/
│   ├── openspec-archive-change/
│   ├── receiving-code-review/
│   ├── using-git-worktrees/
│   ├── using-superpowers/
│   ├── writing-skills/
│   └── graceful-degradation/
├── plugins/
│   ├── ostacky-plugin.ts      ← controller hard-gate (fusiona guard legacy)
│   └── engram.ts              ← plugin Engram
├── mcp/
│   ├── ostacky-controller/    ← MCP thin (observabilidad)
│   └── openspec/
├── tools/
│   ├── codegraph/bin/codegraph
│   └── engram/bin/engram
├── cache/codegraph/           ← cache local CodeGraph/Discovery
├── ostacky-state.json         ← estado por worktree (aislado)
└── ostacky-lock.json          ← versiones instaladas (agentes, commands, skills, mcpServers)
```

> `assets/plugins/ostacky-guard.ts` fue **fusionado en `ostacky-plugin.ts` y eliminado** (re-export legacy). Fresh install solo escribe `ostacky-plugin.ts` + `engram.ts`; si venís de una versión previa con `ostacky-guard.ts` o `ostacky-controller.ts` legacy, el installer los elimina automáticamente.

### ostacky-lock.json

```json
{
    "version": "0.8.1",
    "lockedAt": "2025-01-01T00:00:00.000Z",
    "repo": "JaimeHoracio/Ostacky",
    "tag": "v0.8.1",
    "agents": {
        "ostacky": {
            "version": "0.8.1",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "abc123..."
        }
    },
    "commands": {
        "install-stack": {
            "version": "0.8.1",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "def456..."
        },
        "opsx-sync": {
            "version": "0.8.1",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "ghi789..."
        }
    },
    "skills": {
        "brainstorming": { "version": "0.8.1", ... },
        "execution-mode-evaluation": { "version": "0.8.1", ... },
        "openspec-propose": { "version": "0.8.1", ... }
    },
    "mcpServers": {
        "ostacky-controller": { "version": "0.8.1", ... },
        "openspec": { "version": "0.8.1", ... }
    }
}
```

`plugins/` (`ostacky-plugin.ts`, `engram.ts`) y `tools/` **no** se trackean en el lockfile — son allowlist Ostacky-owned y se gestionan via `uninstall` (allowlist) y `uninstall-stack`.

Se recomienda agregar `ostacky-lock.json` al control de versiones para que el equipo instale exactamente las mismas versiones.

## Después de la instalación

Al terminar la instalación, el flujo normal es:

1. **Iniciar OpenCode** (si no está corriendo):
    - **TUI:** `opencode` en tu terminal → **usá `Tab` para navegar al agente Ostacky** en el panel lateral
    - **Web:** `opencode web --port 4096` y abrí `http://localhost:4096` → **abrí el combo/selector de agentes** en la barra superior y elegí "Ostacky"
2. OpenCode detecta automáticamente los archivos nuevos en `.opencode/` al iniciar, no necesita recarga manual.
3. Para usar el agente **escribí `@Ostacky`** en el chat de OpenCode (TUI o web) y enviá tu mensaje. También podés seleccionarlo desde el selector de agentes (ver arriba cómo).

### Regenerar el stack manualmente

El comando `/install-stack` también está disponible **dentro del chat de OpenCode** (TUI o web) por si querés regenerar el stack local sin salir de la sesión:

```text
@Ostacky /install-stack
```

Es opcional y solo necesario si algo falló durante la instalación o si querés verificar que todo esté en orden.

## Seguridad

- `opencode.jsonc` se versiona en el repo para compartir permisos y MCP de forma reproducible.
- Las URLs de descarga usan **tags de GitHub** (ej. `v0.8.1`), nunca `main` — instalaciones reproducibles
- Cada path de archivo descargado es validado para prevenir **path traversal**
- Los archivos incluyen **checksum SHA-256** opcional; si el manifest lo define, el contenido se verifica antes de escribir
- El cache local (`.opencode/cache/`) también valida integridad al servir archivos cacheados

#### Restricciones de acceso a credenciales

- La configuración local de OpenCode (`opencode.jsonc`) bloquea lectura y escritura de `*.env` y `.secret/**` con `deny`.
- La sesión sigue ejecutándose después del bloqueo porque `experimental.continue_loop_on_deny` está activado.
- Para worktrees, el repo prefiere `.worktrees/` o `worktrees/` (ambos project-local).

#### Patrones sensibles configurables (hardening-v2)

- Variable `OSTACKY_SENSITIVE_PATTERNS` overridea los patrones por defecto (`**/.env*`, `**/.secrets/**`, `**/*.pem`, `**/*.key`, `**/.aws/**`, `**/.ssh/**`, `**/credentials.json`, `**/.npmrc`).
- Ejemplo: `OSTACKY_SENSITIVE_PATTERNS="**/.env*,**/.secrets/**" bunx ostacky doctor` — `doctor` imprime el patrón efectivo.
- Allowlist: `.env.example`, `.env.template`, `.env.sample` nunca se bloquean.
- Fuente única: `src/security.ts` (`SENSITIVE_DEFAULT`, `isSensitive`, `BASH_SENSITIVE_RE`) — `ostacky-plugin.ts` importa de ahí (legacy `ostacky-guard.ts` eliminado, fusionado en el plugin). Ver `doctor` para verificar.

#### Aislamiento de worktrees (harness-prod-hardening)

Cada worktree de git tiene su **propio** `ostacky-state.json` aislado (resuelto via `findProjectRoot()` con `git rev-parse --show-toplevel`). Dos worktrees no comparten `statePath`, locks ni backups — 3 agentes en 3 worktrees no corrompen el estado del otro. Ver `assets/skills/using-git-worktrees/SKILL.md` §Ostacky Worktree Isolation y `src/fs.ts:findProjectRoot`.

## Cache

Los archivos descargados se guardan en:

```
.opencode/cache/<repo>/<tag>/<ruta-del-archivo>
```

Si ya existe un archivo en cache con el hash correcto, no se hace ninguna petición de red.

## Comandos útiles de las herramientas

### Engram (memoria persistente)

Engram está instalado localmente en `.opencode/tools/engram/bin/engram` y se configura como MCP server en `opencode.json`. Desde el chat de OpenCode, usá las tools de Engram directamente. Algunos comandos CLI útiles:

| Comando                                                              | Qué hace                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `.opencode/tools/engram/bin/engram list-projects`                    | Lista todos los proyectos con memoria en Engram           |
| `.opencode/tools/engram/bin/engram clean-content --project <nombre>` | Borra el contenido de memoria de un proyecto específico   |
| `.opencode/tools/engram/bin/engram clean-content --all`              | Borra TODO el contenido de memoria de todos los proyectos |
| `.opencode/tools/engram/bin/engram serve`                            | Inicia el server de session tracking (puerto 7437)        |
| `.opencode/tools/engram/bin/engram --version`                        | Muestra la versión instalada                              |

### CodeGraph (grafo de código)

CodeGraph está instalado en `.opencode/tools/codegraph/bin/codegraph` y se configura como MCP server. Desde el chat de OpenCode, usá las tools de CodeGraph directamente (`codegraph_explore`, `codegraph_trace`, etc.). Algunos comandos CLI útiles:

| Comando                                                                                    | Qué hace                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `.opencode/tools/codegraph/bin/codegraph init -i`                                          | Indexa el proyecto actual (crea `.codegraph/` con el grafo) |
| `.opencode/tools/codegraph/bin/codegraph sync`                                             | Sincroniza cambios incrementales al grafo                   |
| `.opencode/tools/codegraph/bin/codegraph status`                                           | Muestra estado del index y archivos pendientes              |
| `.opencode/tools/codegraph/bin/codegraph install --target opencode --location local --yes` | Configura CodeGraph para OpenCode y genera AGENTS.md        |

## Licencia

MIT
