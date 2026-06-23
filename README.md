# Ostacky

Ostacky es el agente de [OpenCode](https://opencode.ai) que instalás en tu proyecto. Orquesta **4 herramientas** para que trabajen en sinergia: [CodeGraph](https://github.com/colbymchenry/codegraph) entiende el código existente, [OpenSpec](https://github.com/Fission-AI/OpenSpec/) define requisitos y contratos, [Superpowers](https://github.com/obra/superpowers) ejecuta con TDD y review, y [Engram](https://github.com/Gentleman-Programming/engram) da memoria persistente entre sesiones. Ostacky las rutea según el nivel de impacto del cambio para ser eficiente con tokens y evitar recorrer todo el proyecto cuando no hace falta.

## ¿Qué es?

`Ostacky` es el agente (`.opencode/agents/`) que se instala directamente desde GitHub Releases. Cada instalación queda registrada en un lockfile con versión y checksum, lo que permite actualizaciones controladas y reproducibles.

## Stack

Ostacky no es solo un agente — es un **orquestador** que integra cuatro herramientas especializadas para que trabajen en conjunto sin pisarse:

| Herramienta | Rol | Define |
|---|---|---|
| **[CodeGraph](https://github.com/colbymchenry/codegraph)** | Grafo de código | DÓNDE está el código y a quién impacta un cambio |
| **[OpenSpec](https://github.com/Fission-AI/OpenSpec/)** | Especificaciones | QUÉ hay que construir y POR QUÉ |
| **[Superpowers](https://github.com/obra/superpowers)** | Ejecución | CÓMO se implementa, prueba y revisa |
| **[Engram](https://github.com/Gentleman-Programming/engram)** | Memoria persistente | QUÉ aprendimos en sesiones anteriores |

### Cómo trabajan en sinergia

1. **CodeGraph** descubre el alcance del cambio sin escanear el repo entero (consulta `codegraph_context`, `codegraph_impact`).
2. **OpenSpec** documenta requisitos, contratos y escenarios de aceptación (proposal → design → spec → tasks).
3. **Superpowers** ejecuta con TDD, testing automatizado y review (brainstorming → plans → tdd → review).
4. **Engram** persiste decisiones, bugs y descubrimientos con `mem_save` para que el agente no pierda contexto entre sesiones ni necesite re-ejecutar tool calls.

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
    "version": "0.0.6",
    "lockedAt": "2025-01-01T00:00:00.000Z",
    "repo": "JaimeHoracio/Ostacky",
    "tag": "v0.0.6",
    "agents": {
        "ostacky": {
            "version": "0.0.6",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "abc123..."
        }
    },
    "commands": {
        "install-stack": {
            "version": "0.0.6",
            "installedAt": "2025-01-01T00:00:00.000Z",
            "sha256": "def456..."
        }
    }
}
```

Se recomienda agregar `ostacky-lock.json` al control de versiones para que el equipo instale exactamente las mismas versiones.

## Después de la instalación

Al terminar la instalación, el flujo normal es:

1. **Recargar OpenCode** para que detecte los nuevos archivos en `.opencode/`.
2. Ya puedes usar el agente:
    ```
    @Ostacky
    ```
    o seleccionarlo desde la interfaz de OpenCode según la configuración del proyecto. `@Ostacky` invoca al agente que el CLI instaló en `.opencode/agents/ostacky.md`.

Si por alguna razon querés ejecutar el bootstrap manualmente o regenerar el stack local, también está disponible el command:

```bash
/install-stack
```

Ese paso es opcional. Si no aparece en la terminal, recargá OpenCode y volvé a tipearlo.

## Seguridad

- `opencode.jsonc` se versiona en el repo para compartir permisos y MCP de forma reproducible.
- Las URLs de descarga usan **tags de GitHub** (ej. `v0.0.6`), nunca `main` — instalaciones reproducibles
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

## Desarrollo

> Los pasos de esta sección son **solo para quienes quieran contribuir o modificar el código**. Si eres usuario final, no necesitas ejecutar nada de esto — basta con `npx ostacky`.

### Requisitos adicionales para desarrollo

- [Bun](https://bun.sh/) >= 1.x

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/JaimeHoracio/Ostacky.git
cd Ostacky
bun install
```

`bun install` descarga todas las dependencias definidas en `package.json` (incluyendo TypeScript y los tipos de Bun).

### 2. Ejecutar en modo desarrollo

```bash
bun run dev
# equivalente a: bun run src/cli.ts
```

### 3. Compilar la CLI

La CLI se distribuye como un ejecutable JavaScript en `dist/cli.js`. Para generarlo:

```bash
bun run build
```

Este comando ejecuta internamente:

```bash
bun build src/cli.ts --target=node --format=esm --outfile dist/cli.js && bun scripts/add-shebang.ts
```

Tras compilar deberías obtener:

```
dist/
└── cli.js
```

### 4. Probar el binario compilado

```bash
node dist/cli.js
# o
bun run start
```

### Publicar en npm

El script `prepublishOnly` ejecuta `bun run build` automáticamente antes de publicar, por lo que `dist/` siempre estará actualizado al publicar.

```bash
npm publish
```

## Licencia

MIT
