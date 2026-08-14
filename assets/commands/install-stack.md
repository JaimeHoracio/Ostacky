---
description: Instala CodeGraph, skills curadas, OpenSpec, Engram y Context7 localmente para OpenCode únicamente
agent: build
---

Instala el stack tecnológico de desarrollo para OpenCode. **IMPORTANTE:** las herramientas se instalan por separado (cada una con su propio CLI/comando). `npx ostacky install` solo instala el agente y commands de Ostacky en `.opencode/`. Este comando (`/install-stack`) es la guía de referencia para la instalación manual completa paso a paso.

**Nota:** A partir de v0.7.1, `npx ostacky install` ya instala automáticamente el stack completo (CodeGraph, OpenSpec, Engram, Context7, MCPs bundleados) además del agente y skills. Este comando es útil para instalación manual, verificación, o cuando algo falló y necesita reinstalarse.

**RESTRICCIÓN ABSOLUTA:** instalar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear o modificar archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

**Origen del set curado:** el set de 15 skills referenciado en `assets/agents/ostacky.md` está bundleado en `assets/skills/` dentro del paquete npm. Context7 agrega su propio skill vía `npx ctx7 setup --opencode`. La definición del set y su trazabilidad viven en `manifest.json` y `.opencode/ostacky-lock.json`.

---

## Paso 1 — CodeGraph

CodeGraph se instala **localmente** en `.opencode/tools/codegraph/` — no se instala nada globalmente. Desde **v1.5.0+ es un bundle completo** que incluye:

- `bin/codegraph` — ejecutable launcher
- `lib/kernel/codegraph-kernel.node` — kernel nativo (Rust)
- `lib/dist/` — JS runtime
- `lib/node_modules/` — tree-sitter, jsonc-parser, etc.
- `node` — runtime Node empaquetado

`npx ostacky install` (o `npx ostacky install-stack`) hace esto automáticamente. Para instalación manual:

Verificá si ya está descargado localmente:

```bash
# Unix
.opencode/tools/codegraph/bin/codegraph --version
# Windows: ejecutar codegraph.cmd o codegraph.exe dentro de .opencode/tools/codegraph/bin/
```

Si no está, descargalo manualmente desde [GitHub Releases](https://github.com/colbymchenry/codegraph/releases) y extrae el **tar.gz completo** a `.opencode/tools/codegraph/` (estructura: `bin/`, `lib/`, `node`).

Inicializa e indexa el proyecto actual:

```bash
# Unix
.opencode/tools/codegraph/bin/codegraph init -i
# Windows: ejecutar el launcher instalado con `init -i`
```

Verifica que el MCP server esté configurado en `opencode.json` apuntando al binario local:

```json
{
    "mcp": {
        "codegraph": {
            "type": "local",
            "command": [".opencode/tools/codegraph/bin/codegraph", "serve", "--mcp"],
            "enabled": true
        }
    }
}
```

### Desinstalar CodeGraph

Para remover CodeGraph del proyecto:

```bash
# Remover el índice local
rm -rf .codegraph/
# Remover el binario local
rm -rf .opencode/tools/codegraph/
# Remover la entrada MCP de opencode.json (editar el archivo)
```

---

## Paso 1.5 — Ostacky Controller MCP (opcional)

El Ostacky Controller es una máquina de estados persistida que Ostacky usa para validar transiciones, consumir decisiones, autorizar side effects y persistir snapshots.

El controller MCP se configura como server local en `opencode.json`. Si el controller no está disponible, Ostacky cae a inline con confianza reducida pero preserva las compuertas de confirmación en lenguaje natural.

```json
{
    "mcp": {
        "ostacky-controller": {
            "type": "local",
            "command": ["node", ".opencode/mcp/ostacky-controller/index.js"],
            "enabled": true
        }
    }
}
```

**Notas:**

- El controller no es obligatorio para operar Ostacky — es un refuerzo de disciplina.
- Sin controller, Ostacky usa las mismas reglas en lenguaje natural pero sin validación de transiciones ni persistencia de estado. El agente detecta automáticamente si el controller está disponible y opera en modo degraded si no.
- El controller nunca autoriza subagentes sin confirmación explícita del usuario.
- Los MCP servers se copian como archivos autocontenidos (bundleados en `dist/mcp/` durante el build). No requieren `npm install` ni `bun install` — cada `index.js` es un único archivo autocontenido sin dependencias externas.
- El installer maneja `opencode.jsonc` (con comentarios) correctamente — strippea comentarios antes de parsear y escribe JSON válido de vuelta.
- El installer registra el MCP directamente y **no mueve ni elimina** un `AGENTS.md` existente en la raíz del proyecto.

### Verificación post-instalación

Después de instalar, verificá que el controller responde:

```bash
# Desde el prompt de OpenCode con el agente @ostacky activo:
ostacky-controller_ping
```

✅ Respuesta esperada: `{ pong: true, degraded: false, state: { state: 'INTERPRETATION_PENDING', revision: 0, ... } }`

❌ Si no responde o devuelve `pong: false`:

- Verificá que `node` está en PATH (`node --version`)
- Verificá permisos de lectura en `index.js`: `ls -la .opencode/mcp/ostacky-controller/index.js`
- Verificá que `.opencode/ostacky-state.json` no esté corrupto: `cat .opencode/ostacky-state.json | head -5`
- Si está corrupto: `rm .opencode/ostacky-state.json .opencode/ostacky-state.json.backup` y reiniciar OpenCode (el controller recrea el state file).

### Logs del controller

- Errores se loggean en **stderr** con formato `[timestamp] [event] {data}`.
- Archivos persistentes: `.opencode/ostacky-state.json` (state activo) + `.opencode/ostacky-state.json.backup` (último backup válido).
- Lock files: `.opencode/ostacky-state.json.lock*` (temporales durante writes; se limpian automáticamente).
- Eventos importantes: `state_persisted`, `state_restored_from_backup`, `state_reset`, `degraded_mode_activated`, `degraded_mode_exited`, `persist_failed`, `tasks_trimmed`.

### Desinstalar Controller

```bash
# 1. Remover bundle MCP
rm -rf .opencode/mcp/ostacky-controller/

# 2. Remover state files
rm -f .opencode/ostacky-state.json
rm -f .opencode/ostacky-state.json.backup

# 3. Remover lock files
rm -f .opencode/ostacky-state.json.lock*

# 4. Editar opencode.json / opencode.jsonc para remover la entrada "ostacky-controller"
```

Ostacky automáticamente detecta la ausencia del controller y opera en modo degraded (sin validación de transiciones, sin persistencia de estado, pero con todas las reglas de comportamiento en lenguaje natural).

---

## Paso 2 — Skills curadas (bundleadas)

Las **15 skills curadas** están bundleadas dentro del paquete Ostacky en `assets/skills/`. No se descargan ni clonan; ya vienen en el paquete npm. Context7 agrega su propia skill aparte (Paso 6).

Copiá cada skill bundleada a `.opencode/skills/<nombre>/` preservando la estructura interna (incluyendo `SKILL.md` y cualquier subdirectorio como `scripts/` o `references/`):

```bash
# Ejemplo para una skill; aplicar a las 15
mkdir -p .opencode/skills/brainstorming
cp -r assets/skills/brainstorming/* .opencode/skills/brainstorming/
```

**Set curado (15 skills, referenciado en `assets/agents/ostacky.md`):**

`brainstorming`, `tdd`, `review`, `execution-mode-evaluation`, `subagent-driven-development`, `dispatching-parallel-agents`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change`, `receiving-code-review`, `using-git-worktrees`, `using-superpowers`, `writing-skills`, `graceful-degradation`

**Fuente de las 5 skills de Superpowers:**
Las skills `review`, `execution-mode-evaluation`, `subagent-driven-development`, `dispatching-parallel-agents`, `using-superpowers` provienen de `obra/superpowers`:

```
https://github.com/obra/superpowers/tree/main/skills/<nombre>/SKILL.md
```

Se copian a `.opencode/skills/<nombre>/` durante la instalación del bundle.

**NO se requiere** el plugin `superpowers@git+...` en `opencode.json`. Las skills viven en `.opencode/skills/` y OpenCode las descubre automáticamente desde ahí.

---

## Paso 3 — Parche de `opencode.json`

Leé `opencode.json` (o `opencode.jsonc`) en la raíz del proyecto.

**Eliminá** cualquier entrada `"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]` (y equivalentes). Las skills ya están provistas por el bundle local, no por el plugin.

**Preservá** sin tocar el bloque `mcp.codegraph` configurado en el Paso 1.

**Resultado final esperado** de `opencode.json` (o `opencode.jsonc`):

```json
{
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
        "codegraph": {
            "type": "local",
            "command": [".opencode/tools/codegraph/bin/codegraph", "serve", "--mcp"],
            "enabled": true
        },
        "engram": {
            "type": "local",
            "command": [".opencode/tools/engram/bin/engram", "mcp"],
            "enabled": true
        },
        "context7": {
            "type": "remote",
            "url": "https://mcp.context7.com/mcp",
            "enabled": true
        },
        "ostacky-controller": {
            "type": "local",
            "command": ["node", ".opencode/mcp/ostacky-controller/index.js"],
            "enabled": true
        }
    }
}
```

(El campo `plugin` queda ausente, no como array vacío.)

---

## Paso 4 — OpenSpec CLI

OpenSpec se inicializa con su CLI oficial para OpenCode. Genera commands en `.opencode/commands/` y skills en `.opencode/skills/`; **no instala ni registra un MCP server local**.

```bash
npx --yes openspec init --tools opencode --force
```

Los changes se almacenan en `openspec/changes/` y se archivan en `openspec/archive/`.

### Desinstalar OpenSpec

```bash
# Remover commands/skills generados por OpenSpec según corresponda
# Remover changes archivados (opcional)
rm -rf openspec/
```

---

## Paso 5 — Engram

[Engram](https://github.com/Gentleman-Programming/engram) es el sistema de memoria persistente para agentes de IA. Se instala como un único binario Go con SQLite + FTS5, sin Node.js, Python ni Docker.

**Instalación local:** Engram se descarga **localmente** a `.opencode/tools/engram/bin/engram` desde GitHub Releases — no se instala nada globalmente. `npx ostacky install` hace esto automáticamente.

**RESTRICCIÓN:** configurar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

### Verificar instalación local

Chequeá si el binario local de Engram ya está disponible:

```bash
.opencode/tools/engram/bin/engram --version 2>/dev/null || echo "no-instalado"
```

#### Si ya está descargado localmente

Si el comando devuelve una versión, Engram ya está disponible. Verificá si es la más reciente comparando con la [última release en GitHub](https://github.com/Gentleman-Programming/engram/releases).

Si está desactualizado, descargá la nueva versión desde [releases](https://github.com/Gentleman-Programming/engram/releases) y reemplazá el binario en `.opencode/tools/engram/bin/engram`.

Luego de actualizar, saltá directo a [Configurar para OpenCode](#configurar-para-opencode) — no necesitás reinstalar.

#### Si no está instalado

Descargá el binario desde [GitHub Releases](https://github.com/Gentleman-Programming/engram/releases) para tu plataforma:

- **Linux x64:** `engram_{version}_linux_amd64.tar.gz`
- **Linux arm64:** `engram_{version}_linux_arm64.tar.gz`
- **macOS x64:** `engram_{version}_darwin_amd64.tar.gz`
- **macOS arm64:** `engram_{version}_darwin_arm64.tar.gz`
- **Windows x64:** `engram_{version}_windows_amd64.zip`
- **Windows arm64:** `engram_{version}_windows_arm64.zip`

Extraelo a `.opencode/tools/engram/bin/`:

```bash
mkdir -p .opencode/tools/engram/bin
# Descargar y extraer el binario ahí
chmod +x .opencode/tools/engram/bin/engram  # Unix only
```

### Configurar para OpenCode

Una vez que Engram está descargado localmente, el plugin se copia automáticamente de `assets/plugins/` a `.opencode/plugins/` durante la instalación. No necesitás correr ningún comando adicional.

Este comando:

- Copia el plugin de Engram para OpenCode a `.opencode/plugins/`
- **NO** agrega la entrada MCP al `opencode.json` del proyecto — eso lo hace `npx ostacky install` automáticamente
- **NO** toca `.claude/`, `.cursor/`, `.gemini/` ni ninguna otra plataforma

Verificá que `opencode.json` contenga la entrada MCP de Engram apuntando al binario local (agregada por el installer de Ostacky):

```json
{
    "mcp": {
        "engram": {
            "type": "local",
            "command": [".opencode/tools/engram/bin/engram", "mcp"],
            "enabled": true
        }
    }
}
```

Si la entrada no está presente (por ejemplo si instalaste Engram manualmente sin Ostacky), agregala a mano al `opencode.json` o `opencode.jsonc`.

### Session tracking

El plugin de Engram para OpenCode usa `engram serve` para session tracking y recuperación ante compaction. El plugin intenta auto-iniciar el servidor, pero si tu entorno bloquea procesos en background, iniciálo manualmente:

```bash
engram serve
```

Corre en el puerto 7437 por defecto. Los datos se almacenan en `~/.engram/engram.db` (SQLite local). **Nota:** esta ruta está hardcoded en el binario de Engram y no es configurable por Ostacky.

### Desinstalar Engram del proyecto

Para remover la configuración de Engram del proyecto (sin borrar los datos):

```bash
# Remover la entrada mcp.engram de opencode.json (editar el archivo)
# Remover el plugin de Engram de OpenCode:
rm -f .opencode/plugins/engram.ts
# Remover el binario local
rm -rf .opencode/tools/engram/
```

Para borrar todos los datos de Engram (**OPCIONAL** — esto borra la memoria persistente de TODOS los proyectos que usen Engram):

```bash
# ⚠️ Solo si querés borrar toda la memoria de Engram
rm -rf ~/.engram/
```

---

## Paso 6 — Context7

[Context7](https://context7.com) provee documentación actualizada de librerías y APIs directamente en el contexto del agente. Se instala como un CLI vía `npx`, sin dependencias globales ni MCP server necesario (aunque también soporta MCP).

**RESTRICCIÓN:** configurar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

### Verificar instalación actual

Chequeá si Context7 ya está configurado para OpenCode:

```bash
ls -la .opencode/skills/context7/ 2>/dev/null || echo "no-instalado"
```

También podés verificar si el MCP server de Context7 está en `opencode.json`:

```bash
grep -c "context7" opencode.json 2>/dev/null || echo "no-configurado"
```

### Instalar

**Opción recomendada — setup automático (CLI + skills):**

```bash
npx ctx7 setup --opencode
```

Este comando:

- Autentica vía OAuth y genera una API key
- Instala un skill en `.opencode/skills/context7/` que el agente Ostacky usa automáticamente
- Pregunta si preferís modo CLI + Skills o MCP
- **NO** toca `.claude/`, `.cursor/`, `.gemini/` ni ninguna otra plataforma

**Alternativa — solo MCP (si preferís el server remoto):**

Agregá manualmente la entrada MCP en `opencode.json`:

```json
{
    "mcp": {
        "context7": {
            "type": "remote",
            "url": "https://mcp.context7.com/mcp"
        }
    }
}
```

Si tenés una API key de Context7 (recomendado para mejores rate limits):

```json
{
    "mcp": {
        "context7": {
            "type": "remote",
            "url": "https://mcp.context7.com/mcp",
            "headers": {
                "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
            }
        }
    }
}
```

### Desinstalar

Para remover la configuración generada por `npx ctx7 setup`:

```bash
npx ctx7 remove
```

Esto elimina el skill y la configuración de Context7. Si instalaste el CLI globalmente con `npm install -g ctx7`, también necesitás:

```bash
npm uninstall -g ctx7
```

Para remover la entrada MCP manual, editá `opencode.json` y eliminá el bloque `mcp.context7`.

### Cómo lo usa Ostacky

El skill de Context7 instalado le indica al agente Ostacky que use Context7 automáticamente cuando necesite documentación de librerías, APIs o frameworks. También se puede invocar explícitamente:

```
usá context7 para mostrarme la API de autenticación de Supabase
use context7 to find Next.js 15 app router examples
```

---

## Estructura de herramientas

Cada herramienta se instala en su propia carpeta dentro de `.opencode/` para mantener una instalación limpia y aislada. El installer crea automáticamente `.opencode/tools/<nombre>/` para cada herramienta externa:

```
.opencode/
├── agents/          # Agentes OpenCode
│   └── ostacky.md
├── commands/        # Comandos OpenCode
│   ├── install-stack.md      # Bundleado por Ostacky
│   ├── opsx-sync.md          # Bundleado por Ostacky
│   ├── opsx-apply.md         # Generado por OpenSpec
│   ├── opsx-archive.md       # Generado por OpenSpec
│   ├── opsx-explore.md       # Generado por OpenSpec
│   └── opsx-propose.md       # Generado por OpenSpec
├── mcp/             # MCP servers bundleados
│   ├── ostacky-controller/
│   │   ├── index.js
│   │   ├── package.json
│   │   └── node_modules/    # Solo fallback de desarrollo
├── skills/          # Skills bundleadas (15)
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
├── tools/           # Config y archivos de herramientas externas
│   ├── codegraph/   # Config de CodeGraph (AGENTS.md si codegraph lo crea)
│   ├── engram/      # Config project-local de Engram
│   └── context7/    # Config de Context7
└── plugins/         # Plugins de OpenCode
```

**Notas sobre la estructura:**

- `.codegraph/` (índice de CodeGraph) vive en la raíz del proyecto — CodeGraph lo espera ahí.
- El binario de CodeGraph es **local al proyecto** en `.opencode/tools/codegraph/bin/`; en Windows puede ser `codegraph.cmd`. No se instala globalmente.
- El binario de Engram es **local al proyecto** en `.opencode/tools/engram/bin/engram` (o `engram.exe` en Windows). No se instala globalmente.
- Context7 se registra como MCP remoto en `opencode.jsonc`. Su skill opcional se instala via `npx ctx7 setup --opencode` en `.opencode/skills/context7/`.
- El controller publicado se bundlea como un único `index.js`; durante desarrollo el installer instala sus dependencias en staging y valida el servidor antes de activarlo.

## Verificación final

Confirmá que:

1. `.opencode/skills/` contiene las 15 skills curadas y opcionalmente `context7/` si se instaló con `npx ctx7 setup --opencode`
2. `.opencode/commands/` contiene los commands bundleados por Ostacky (`install-stack`, `opsx-sync`) y los 4 commands generados por OpenSpec (`opsx-apply`, `opsx-archive`, `opsx-explore`, `opsx-propose`) si OpenSpec fue inicializado
3. `opencode.json` (o `.jsonc`) tiene los bloques MCP: `codegraph`, `engram`, `context7`, `ostacky-controller` — sin campo `plugin`
4. `.codegraph/` existe en la raíz del proyecto (índice local de CodeGraph)
5. El launcher local de CodeGraph funciona (`codegraph.cmd --version` en Windows o `codegraph --version` en Unix)
6. El binario local de Engram funciona (`engram.exe --version` en Windows o `engram --version` en Unix)
7. Context7 configurado: `mcp.context7` presente en `opencode.jsonc` y/o `.opencode/skills/context7/SKILL.md` existe
8. OpenSpec generó sus commands/skills para OpenCode mediante `openspec init --tools opencode`
9. `.opencode/tools/` contiene subdirectorios para `codegraph/`, `engram/` y `context7/`
10. **NO existen** archivos generados en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/` ni ningún directorio de otra plataforma
11. Un `AGENTS.md` preexistente en la raíz del proyecto se preserva sin cambios

Reportá el estado de cada componente con ✓ o ✗.

## Troubleshooting

### MCP Server no responde

Si el controller MCP no responde después de la instalación:

1. **Verificar que el archivo existe:**

    ```bash
    ls -la .opencode/mcp/ostacky-controller/index.js
    ```

2. **Verificar que Node.js está disponible:**

    ```bash
    node --version
    ```

3. **Testear el MCP server directamente:**

    ```bash
    echo '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' | node .opencode/mcp/ostacky-controller/index.js
    ```

4. **Si falla, reinstalar:**
    ```bash
    npx ostacky install-stack
    ```

### CodeGraph no indexa

1. **Verificar que el binario funciona:**

    ```bash
    .opencode/tools/codegraph/bin/codegraph --version
    ```

2. **Re-inicializar el índice:**

    ```bash
    .opencode/tools/codegraph/bin/codegraph init -i
    ```

3. **Si el binario no existe, reinstalar:**
    ```bash
    npx ostacky install-stack
    ```

### Engram no inicia

1. **Verificar que el binario funciona:**

    ```bash
    .opencode/tools/engram/bin/engram --version
    ```

2. **Verificar que el plugin está instalado:**

    ```bash
    ls -la .opencode/plugins/engram.ts
    ```

3. **Re-instalar el plugin:**
    ```bash
    cp assets/plugins/engram.ts .opencode/plugins/engram.ts
    ```

### Degradación graceful

Si múltiples tools fallan, Ostacky opera en modo degraded. Ver `assets/skills/graceful-degradation/SKILL.md` para los flujos alternativos disponibles.
