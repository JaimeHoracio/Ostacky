---
description: Instala CodeGraph, skills curadas, OpenSpec, Engram y Context7 localmente para OpenCode únicamente
agent: build
---

Instala el stack tecnológico de desarrollo para OpenCode. **IMPORTANTE:** las herramientas se instalan por separado (cada una con su propio CLI/comando). `npx ostacky install` solo instala el agente y commands de Ostacky en `.opencode/`. Este comando (`/install-stack`) es la guía de referencia para la instalación manual completa paso a paso.

**Nota:** A partir de v0.5.5, `npx ostacky install` ya instala automáticamente el stack completo (CodeGraph, OpenSpec, Engram, Context7, MCPs bundleados) además del agente y skills. Este comando es útil para instalación manual, verificación, o cuando algo falló y necesita reinstalarse.

**RESTRICCIÓN ABSOLUTA:** instalar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear o modificar archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

**Origen del set curado:** el set de skills (6 Superpowers + 4 OpenSpec) referenciado en `assets/agents/ostacky.md` está bundleado en `assets/skills/` dentro del paquete npm. Context7 agrega su propio skill vía `npx ctx7 setup --opencode`. La definición del set y su trazabilidad viven en `manifest.json` y `.opencode/ostacky-lock.json`.

---

## Paso 1 — CodeGraph

CodeGraph se instala **localmente** en `.opencode/tools/codegraph/` — no se instala nada globalmente. El binario se descarga desde GitHub Releases para tu plataforma (linux/darwin x64/arm64, win32).

`npx ostacky install` (o `npx ostacky install-stack`) hace esto automáticamente. Para instalación manual:

Verificá si ya está descargado localmente:

```bash
.opencode/tools/codegraph/bin/codegraph --version
```

Si no está, descargalo manualmente desde [GitHub Releases](https://github.com/colbymchenry/codegraph/releases) y extraelo a `.opencode/tools/codegraph/` (el tar.gz tiene estructura `codegraph-{os}-{arch}/bin/codegraph`, `lib/`, `node`).

Inicializa e indexa el proyecto actual:

```bash
.opencode/tools/codegraph/bin/codegraph init -i
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
        "ask-user-server": {
            "type": "local",
            "command": ["node", ".opencode/mcp/ask-user-server/index.js"],
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

**Notas:**

- El controller no es obligatorio para operar Ostacky — es un refuerzo de disciplina.
- Sin controller, Ostacky usa las mismas reglas en lenguaje natural pero sin validación de transiciones ni persistencia de estado.
- El controller nunca autoriza subagentes sin confirmación explícita del usuario.
- Los MCP servers usan el SDK oficial `@modelcontextprotocol/server` (v2 beta) con `@modelcontextprotocol/server/stdio` para el transporte, y `zod/v4` para validación de schemas. Los `package.json` de cada MCP declaran estas dependencias y el installer corre `npm install` automáticamente después de copiar los archivos.
- Después de copiar cada MCP server a `.opencode/mcp/<name>/`, se ejecuta `npm install` automáticamente para instalar sus dependencias. Si falla, el installer reporta el error en vez de silenciarlo.
- El installer maneja `opencode.jsonc` (con comentarios) correctamente — strippea comentarios antes de parsear y escribe JSON válido de vuelta.
- Si CodeGraph crea un `AGENTS.md` en la raíz del proyecto, el installer lo mueve a `.opencode/tools/codegraph/AGENTS.md` automáticamente.

---

## Paso 2 — Skills curadas (bundleadas)

Las **11 skills curadas del set base** (6 Superpowers + 4 OpenSpec + 1 Ostacky) están bundleadas dentro del paquete Ostacky en `assets/skills/`. No se descargan ni clonan; ya vienen en el paquete npm. Context7 agrega su propia skill aparte (Paso 6).

Copiá cada skill bundleada a `.opencode/skills/<nombre>/` preservando la estructura interna (incluyendo `SKILL.md` y cualquier subdirectorio como `scripts/` o `references/`):

```bash
# Ejemplo para una skill; aplicar a las 11
mkdir -p .opencode/skills/brainstorming
cp -r assets/skills/brainstorming/* .opencode/skills/brainstorming/
```

**Set curado (referenciado en `assets/agents/ostacky.md`):**

**Superpowers (6):** `brainstorming`, `writing-plans`, `tdd`, `subagent-driven-development`, `dispatching-parallel-agents`, `review`

**OpenSpec (4):** `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change`

**Ostacky (1):** `execution-mode-evaluation` — análisis de modo de ejecución (INLINE vs SUBAGENT_DRIVEN)

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
            "command": [".opencode/tools/engram/engram", "mcp"],
            "enabled": true
        },
        "context7": {
            "type": "remote",
            "url": "https://mcp.context7.com/mcp",
            "enabled": true
        },
        "ask-user-server": {
            "type": "local",
            "command": ["node", ".opencode/mcp/ask-user-server/index.js"],
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

## Paso 4 — OpenSpec

Inicializá OpenSpec configurándolo exclusivamente para OpenCode:

```bash
npx --yes openspec init --tools opencode --force
```

El flag `--tools opencode` garantiza que solo se generen archivos en `.opencode/skills/` y `.opencode/commands/`. El flag `--force` limpia archivos legacy de inicializaciones anteriores que hayan podido configurar otras plataformas.

Si OpenSpec ya estaba correctamente inicializado para opencode, ejecutá en su lugar:

```bash
npx --yes openspec update
```

**IMPORTANTE:** verificar después de la ejecución que no existan carpetas `.claude/`, `.kiro/`, `.cursor/` ni similares generadas por OpenSpec. Si existen, eliminalas.

### Desinstalar OpenSpec

Para remover los archivos de OpenSpec del proyecto:

```bash
# Eliminar skills y commands de OpenSpec generados en .opencode/
rm -rf .opencode/skills/openspec-explore .opencode/skills/openspec-propose \
       .opencode/skills/openspec-apply-change .opencode/skills/openspec-archive-change
# Los specs y changes viven en openspec/ — eliminarlos si no los necesitás:
rm -rf openspec/
```

Esto no desinstala el CLI de OpenSpec (que se ejecuta via `npx`), solo limpia los artefactos del proyecto.

---

## Paso 5 — Engram

[Engram](https://github.com/Gentleman-Programming/engram) es el sistema de memoria persistente para agentes de IA. Se instala como un único binario Go con SQLite + FTS5, sin Node.js, Python ni Docker.

**Instalación local:** Engram se descarga **localmente** a `.opencode/tools/engram/engram` desde GitHub Releases — no se instala nada globalmente. `npx ostacky install` hace esto automáticamente.

**RESTRICCIÓN:** configurar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

### Verificar instalación local

Chequeá si el binario local de Engram ya está disponible:

```bash
.opencode/tools/engram/engram --version 2>/dev/null || echo "no-instalado"
```

#### Si ya está descargado localmente

Si el comando devuelve una versión, Engram ya está disponible. Verificá si es la más reciente comparando con la [última release en GitHub](https://github.com/Gentleman-Programming/engram/releases).

Si está desactualizado, descargá la nueva versión desde [releases](https://github.com/Gentleman-Programming/engram/releases) y reemplazá el binario en `.opencode/tools/engram/engram`.

Luego de actualizar, saltá directo a [Configurar para OpenCode](#configurar-para-opencode) — no necesitás reinstalar.

#### Si no está instalado

Descargá el binario desde [GitHub Releases](https://github.com/Gentleman-Programming/engram/releases) para tu plataforma:

- **Linux x64:** `engram_{version}_linux_amd64.tar.gz`
- **Linux arm64:** `engram_{version}_linux_arm64.tar.gz`
- **macOS x64:** `engram_{version}_darwin_amd64.tar.gz`
- **macOS arm64:** `engram_{version}_darwin_arm64.tar.gz`
- **Windows x64:** `engram_{version}_windows_amd64.zip`
- **Windows arm64:** `engram_{version}_windows_arm64.zip`

Extraelo a `.opencode/tools/engram/`:

```bash
mkdir -p .opencode/tools/engram
# Descargar y extraer el binario ahí
chmod +x .opencode/tools/engram/engram  # Unix only
```

### Configurar para OpenCode

Una vez que Engram está descargado localmente, ejecutá el setup que instala el plugin de OpenCode:

```bash
.opencode/tools/engram/engram setup opencode
```

Este comando:

- Instala el plugin de Engram para OpenCode en `~/.config/opencode/plugins/`
- **NO** agrega la entrada MCP al `opencode.json` del proyecto — eso lo hace `npx ostacky install` automáticamente
- **NO** toca `.claude/`, `.cursor/`, `.gemini/` ni ninguna otra plataforma

Verificá que `opencode.json` contenga la entrada MCP de Engram apuntando al binario local (agregada por el installer de Ostacky, no por `engram setup`):

```json
{
    "mcp": {
        "engram": {
            "type": "local",
            "command": [".opencode/tools/engram/engram", "mcp"],
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

Corre en el puerto 7437 por defecto. Los datos se almacenan en `~/.engram/engram.db` (SQLite local).

### Desinstalar Engram del proyecto

Para remover la configuración de Engram del proyecto (sin borrar los datos):

```bash
# Remover la entrada mcp.engram de opencode.json (editar el archivo)
# Remover el plugin de Engram de OpenCode:
rm -f ~/.config/opencode/plugins/engram.ts
# Remover el binario local
rm -rf .opencode/tools/engram/
```

Para borrar todos los datos de Engram (CUIDADO: borra toda la memoria persistente):

```bash
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
├── mcp/             # MCP servers bundleados (con node_modules)
│   ├── ask-user-server/
│   │   ├── index.js
│   │   ├── package.json
│   │   └── node_modules/
│   └── ostacky-controller/
│       ├── index.js
│       ├── package.json
│       └── node_modules/
├── skills/          # Skills bundleadas
│   ├── brainstorming/
│   ├── writing-plans/
│   ├── tdd/
│   ├── subagent-driven-development/
│   ├── dispatching-parallel-agents/
│   ├── review/
│   ├── openspec-explore/
│   ├── openspec-propose/
│   ├── openspec-apply-change/
│   ├── openspec-archive-change/
│   └── execution-mode-evaluation/
├── tools/           # Config y archivos de herramientas externas
│   ├── codegraph/   # Config de CodeGraph (AGENTS.md si codegraph lo crea)
│   ├── engram/      # Config project-local de Engram
│   └── context7/    # Config de Context7
└── plugins/         # Plugins de OpenCode
```

**Notas sobre la estructura:**

- `.codegraph/` (índice de CodeGraph) vive en la raíz del proyecto — CodeGraph lo espera ahí.
- El binario de CodeGraph es **local al proyecto** en `.opencode/tools/codegraph/bin/codegraph` (con su runtime Node vendored en `.opencode/tools/codegraph/node`). No se instala globalmente.
- El binario de Engram es **local al proyecto** en `.opencode/tools/engram/engram`. No se instala globalmente.
- Context7 se registra como MCP remoto en `opencode.jsonc`. Su skill opcional se instala via `npx ctx7 setup --opencode` en `.opencode/skills/context7/`.
- Los MCP servers bundleados tienen sus `node_modules/` instalados localmente dentro de `.opencode/mcp/<name>/`.

## Verificación final

Confirmá que:

1. `.opencode/skills/` contiene las skills curadas (6 Superpowers + 4 OpenSpec + 1 Ostacky `execution-mode-evaluation`) y opcionalmente `context7/` si se instaló con `npx ctx7 setup --opencode`
2. `.opencode/commands/` contiene los commands bundleados por Ostacky (`install-stack`, `opsx-sync`) y los 4 commands generados por OpenSpec (`opsx-apply`, `opsx-archive`, `opsx-explore`, `opsx-propose`) si OpenSpec fue inicializado en el Paso 4
3. `opencode.json` (o `.jsonc`) tiene los bloques `mcp.codegraph` (apuntando a `.opencode/tools/codegraph/bin/codegraph`), `mcp.engram` (apuntando a `.opencode/tools/engram/engram`), `mcp.context7` y los MCP bundleados (`ask-user-server`, `ostacky-controller`) — sin campo `plugin`
4. `.codegraph/` existe en la raíz del proyecto (índice local de CodeGraph)
5. `.opencode/tools/codegraph/bin/codegraph --version` funciona (binario local)
6. `.opencode/tools/engram/engram --version` funciona (binario local)
7. Context7 configurado: `mcp.context7` presente en `opencode.jsonc` y/o `.opencode/skills/context7/SKILL.md` existe
8. Los MCP bundleados tienen sus dependencias instaladas en `.opencode/mcp/*/node_modules/`
9. `.opencode/tools/` contiene subdirectorios para `codegraph/`, `engram/` y `context7/`
10. **NO existen** archivos generados en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/` ni ningún directorio de otra plataforma
11. **NO existe** `AGENTS.md` en la raíz del proyecto (si CodeGraph lo creó, el installer lo mueve a `.opencode/tools/codegraph/`)

Reportá el estado de cada componente con ✓ o ✗.
