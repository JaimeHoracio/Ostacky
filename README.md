# Ostacky

Ostacky es un **agent harness** para [OpenCode](https://opencode.ai). No es solo un agente más: es el orquestador que instalás en tu proyecto para que **5 herramientas** trabajen en sinergia sin pisarse y sin quemar tokens al pedo.

| Herramienta                                               | Rol                 | Define                                        |
| --------------------------------------------------------- | ------------------- | --------------------------------------------- |
| [CodeGraph](https://github.com/colbymchenry/codegraph)    | Grafo de código     | DÓNDE está el código y a quién impacta        |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec/)       | Especificaciones    | QUÉ hay que construir y POR QUÉ               |
| [Superpowers](https://github.com/obra/superpowers)        | Ejecución           | CÓMO se implementa, prueba y revisa           |
| [Engram](https://github.com/Gentleman-Programming/engram) | Memoria persistente | QUÉ aprendimos en sesiones anteriores         |
| [Context7](https://context7.com)                          | Documentación viva  | Documentación actualizada de librerías y APIs |

Ostacky las rutea según el **nivel de impacto del cambio** (Nivel 0, Nivel 0+1, Nivel 1+), priorizando siempre eficiencia de tokens y preguntándote antes de actuar.

## Cómo empezar

Después de instalar Ostacky (con `npx ostacky install`), necesitás iniciar OpenCode para usarlo. Tenés dos formas:

### Terminal UI (TUI) — recomendado para daily driving

```bash
opencode
```

Abre la interfaz de terminal interactiva. Seleccioná el agente `@Ostacky` desde el panel de agentes o escribí `/agent Ostacky`.

### Web UI — para usar desde el navegador

```bash
opencode web --port 4096
```

Abre OpenCode en el navegador en `http://localhost:4096`. Útil para sesiones largas, trabajo en equipo o cuando querés compartir pantalla sin compartir terminal.

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

Ostacky integra **5 herramientas** especializadas para que trabajen en conjunto sin pisarse:

### Cómo trabajan en sinergia

1. **CodeGraph** descubre el alcance del cambio sin escanear el repo entero (consulta `codegraph_context`, `codegraph_impact`).
2. **OpenSpec** documenta requisitos, contratos y escenarios de aceptación (proposal → design → spec → tasks).
3. **Superpowers** ejecuta con TDD, testing automatizado y review (brainstorming → plans → tdd → review).
4. **Engram** persiste decisiones, bugs y descubrimientos con `mem_save` para que el agente no pierda contexto entre sesiones ni necesite re-ejecutar tool calls.
5. **Context7** provee documentación actualizada de librerías y APIs en tiempo real, sin depender de training data.

Ostacky decide **cuándo y cómo** usar cada herramienta según el nivel de impacto del cambio (Nivel 0, Nivel 0+1, Nivel 1+), priorizando siempre eficiencia de tokens.

## ¿Para qué sirve?

- Instalar el agente `Ostacky` en cualquier proyecto con un solo comando.
- Mantener un registro de qué versión está instalada (`ostacky-lock.json`)
- Detectar y aplicar actualizaciones mostrando el diff de versiones antes de confirmar
- Evitar descargas repetidas gracias al cache local en `~/.opencode/cache/`
- Resolver tareas chicas sin overhead extra de coordinación.

## Requisitos

- [Node.js](https://nodejs.org/) >= 18 (para usar con `npx`)
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
npx ostacky install
```

Descarga todos los agentes y commands definidos en el manifest y los escribe en `.opencode/`.

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
npx ostacky uninstall
```

Borra todos los archivos instalados (los listados en `.opencode/ostacky-lock.json`). Antes de borrar, muestra un preview con los paths a eliminar y pide confirmación.

#### Desinstalar un agente puntual

```bash
npx ostacky uninstall agent <nombre>
```

Por ejemplo:

```bash
npx ostacky uninstall agent ostacky
```

#### Desinstalar un command puntual

```bash
npx ostacky uninstall command <nombre>
```

Por ejemplo:

```bash
npx ostacky uninstall command install-stack
```

Si no especificás el nombre, el CLI te muestra un selector con los items instalados para que elijas cuáles desinstalar (puede ser uno o varios).

### Otros

```bash
npx ostacky --version   # muestra la versión del CLI
npx ostacky --help      # muestra la ayuda
```

## Estructura generada

Tras instalar, el proyecto queda así:

```
.opencode/
├── agents/
│   └── ostacky.md
├── commands/
│   └── install-stack.md
└── ostacky-lock.json          ← versiones instaladas
```

### ostacky-lock.json

```json
{
    "version": "0.3.0",
    "lockedAt": "2025-01-01T00:00:00.000Z",
    "repo": "JaimeHoracio/Ostacky",
    "tag": "v0.3.0",
    "agents": {
        "ostacky": {
            "version": "0.3.0",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "abc123..."
        }
    },
    "commands": {
        "install-stack": {
            "version": "0.3.0",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "def456..."
        }
    }
}
```

Se recomienda agregar `ostacky-lock.json` al control de versiones para que el equipo instale exactamente las mismas versiones.

## Después de la instalación

Al terminar la instalación, el flujo normal es:

1. **Iniciar OpenCode** (si no está corriendo):
    - **TUI:** `opencode` en tu terminal
    - **Web:** `opencode web --port 4096` y abrí `http://localhost:4096`
2. OpenCode detecta automáticamente los archivos nuevos en `.opencode/` al iniciar, no necesita recarga manual.
3. Para usar el agente **escribí `@Ostacky`** en el chat de OpenCode (TUI o web) y enviá tu mensaje. También podés seleccionarlo desde el selector de agentes si tu versión de OpenCode lo soporta.

### Regenerar el stack manualmente

El comando `/install-stack` también está disponible **dentro del chat de OpenCode** (TUI o web) por si querés regenerar el stack local sin salir de la sesión:

```text
@Ostacky /install-stack
```

Es opcional y solo necesario si algo falló durante la instalación o si querés verificar que todo esté en orden.

## Seguridad

- `opencode.jsonc` se versiona en el repo para compartir permisos y MCP de forma reproducible.
- Las URLs de descarga usan **tags de GitHub** (ej. `v0.3.0`), nunca `main` — instalaciones reproducibles
- Cada path de archivo descargado es validado para prevenir **path traversal**
- Los archivos incluyen **checksum SHA-256** opcional; si el manifest lo define, el contenido se verifica antes de escribir
- El cache local (`~/.opencode/cache/`) también valida integridad al servir archivos cacheados

#### Restricciones de acceso a credenciales

- La configuración local de OpenCode (`opencode.jsonc`) bloquea lectura y escritura de `*.env` y `.secret/**` con `deny`.
- La sesión sigue ejecutándose después del bloqueo porque `experimental.continue_loop_on_deny` está activado.
- Para worktrees, el repo prefiere `.worktrees/`; `~/.config/superpowers/worktrees` solo se usa con confirmación explícita.

## Cache

Los archivos descargados se guardan en:

```
~/.opencode/cache/<repo>/<tag>/<ruta-del-archivo>
```

Si ya existe un archivo en cache con el hash correcto, no se hace ninguna petición de red.

## Licencia

MIT
