---
description: Instala CodeGraph, skills curadas y OpenSpec localmente para OpenCode únicamente
agent: build
---

Instala el stack tecnológico de desarrollo para este proyecto, basado en el set curado de 10 skills bundleado dentro del paquete Ostacky.

**RESTRICCIÓN ABSOLUTA:** instalar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear o modificar archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

**Origen del set curado:** el set de 10 skills (6 Superpowers + 4 OpenSpec) referenciado en `assets/agents/ostacky.md` está bundleado en `assets/skills/` dentro del paquete npm. La definición del set y su trazabilidad viven en `manifest.json` y `.opencode/ostacky-lock.json`.

---

## Paso 1 — CodeGraph

Verifica si `codegraph` está disponible en el PATH:

```bash
codegraph --version
```

Si no está instalado, instálalo según el sistema operativo:
- **Windows:** `irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex`
- **macOS/Linux:** `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh`

Luego instala CodeGraph localmente, apuntando solo a OpenCode:

```bash
codegraph install --target=opencode --location=local --yes
```

Inicializa e indexa el proyecto actual:

```bash
codegraph init -i
```

Verifica que el MCP server esté configurado en `opencode.json` (campo `mcpServers`) y que NO se hayan tocado configuraciones de otras plataformas.

---

## Paso 2 — Skills curadas (bundleadas)

Las 10 skills curadas están bundleadas dentro del paquete Ostacky en `assets/skills/`. No se descargan ni clonan en tiempo de install; ya vienen en el paquete npm.

Copiá cada skill bundleada a `.opencode/skills/<nombre>/` preservando la estructura interna (incluyendo `SKILL.md` y cualquier subdirectorio como `scripts/` o `references/`):

```bash
# Ejemplo para una skill; aplicar a las 10
mkdir -p .opencode/skills/brainstorming
cp -r assets/skills/brainstorming/* .opencode/skills/brainstorming/
```

**Set curado (referenciado en `assets/agents/ostacky.md`):**

**Superpowers (6):** `brainstorming`, `writing-plans`, `tdd`, `subagent-driven-development`, `dispatching-parallel-agents`, `review`

**OpenSpec (4):** `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-archive-change`

**NO se requiere** el plugin `superpowers@git+...` en `opencode.json`. Las skills viven en `.opencode/skills/` y OpenCode las descubre automáticamente desde ahí.

---

## Paso 3 — Parche de `opencode.json`

Leé `opencode.json` (o `opencode.jsonc`) en la raíz del proyecto.

**Eliminá** cualquier entrada `"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]` (y equivalentes). Las skills ya están provistas por el bundle local, no por el plugin.

**Preservá** sin tocar el bloque `mcp.codegraph` configurado en el Paso 1.

**Resultado final esperado** de `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["codegraph", "serve", "--mcp"],
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
openspec init --tools opencode --force
```

El flag `--tools opencode` garantiza que solo se generen archivos en `.opencode/skills/` y `.opencode/commands/`. El flag `--force` limpia archivos legacy de inicializaciones anteriores que hayan podido configurar otras plataformas.

Si OpenSpec ya estaba correctamente inicializado para opencode, ejecutá en su lugar:

```bash
openspec update
```

**IMPORTANTE:** verificar después de la ejecución que no existan carpetas `.claude/`, `.kiro/`, `.cursor/` ni similares generadas por OpenSpec. Si existen, eliminalas.

---

## Paso 5 — Engram

[Engram](https://github.com/Gentleman-Programming/engram) es el sistema de memoria persistente para agentes de IA. Se instala como un único binario Go con SQLite + FTS5, sin Node.js, Python ni Docker.

**RESTRICCIÓN:** configurar ÚNICAMENTE para OpenCode. No crear archivos en `.claude/`, `.cursor/` ni otros directorios de otras plataformas.

### Verificar instalación actual

Chequeá si Engram ya está disponible:

```bash
engram --version 2>/dev/null || echo "no-instalado"
```

#### Si ya está instalado

Si el comando devuelve una versión, Engram ya está en el sistema. Verificá si es la más reciente comparando con la [última release en GitHub](https://github.com/Gentleman-Programming/engram/releases).

Si está desactualizado, actualizá según cómo lo instalaste originalmente:

- **go install:** `go install github.com/Gentleman-Programming/engram/cmd/engram@latest`
- **Homebrew:** `brew update && brew upgrade engram`
- **Binario propio:** descargá la nueva versión desde [releases](https://github.com/Gentleman-Programming/engram/releases) y reemplazá el binario

Luego de actualizar, saltá directo a [Configurar para OpenCode](#configurar-para-opencode) — no necesitás reinstalar.

#### Si no está instalado

Preferí métodos de instalación local antes que global:

**Opción recomendada — `go install` (local por usuario, sin sudo):**

```bash
go install github.com/Gentleman-Programming/engram/cmd/engram@latest
```

El binario se instala en `$GOPATH/bin/engram` (usualmente `~/go/bin/engram`).

**Alternativa — Homebrew (macOS/Linux):**

```bash
brew install gentleman-programming/tap/engram
```

**Alternativa — binario en el proyecto (máxima localidad):**

```bash
mkdir -p .opencode/bin
# Descargar el binario desde https://github.com/Gentleman-Programming/engram/releases
# y colocarlo en .opencode/bin/engram, luego:
chmod +x .opencode/bin/engram
```

### Configurar para OpenCode

Una vez que Engram está instalado (ya sea porque ya lo tenías, lo actualizaste o lo instalaste ahora), ejecutá el setup que lo registra exclusivamente para OpenCode:

```bash
engram setup opencode
```

Este comando:
- Agrega el MCP server de Engram en `opencode.json` (tipo `local`, comando `engram mcp`)
- Instala el plugin de Engram para OpenCode
- **NO** toca `.claude/`, `.cursor/`, `.gemini/` ni ninguna otra plataforma

Verificá que `opencode.json` contenga la entrada MCP de Engram:

```json
{
  "mcp": {
    "engram": {
      "type": "local",
      "command": ["engram", "mcp"],
      "enabled": true
    }
  }
}
```

### Session tracking

El plugin de Engram para OpenCode usa `engram serve` para session tracking y recuperación ante compaction. El plugin intenta auto-iniciar el servidor, pero si tu entorno bloquea procesos en background, iniciálo manualmente:

```bash
engram serve
```

Corre en el puerto 7437 por defecto. Los datos se almacenan en `~/.engram/engram.db` (SQLite local).

---

## Verificación final

Confirmá que:

1. `.opencode/skills/` contiene las 10 skills curadas (cada una con su `SKILL.md`; algunas traen `scripts/` y `references/`)
2. `.opencode/commands/` contiene los 5 opsx-* commands (`opsx-apply`, `opsx-archive`, `opsx-explore`, `opsx-propose`, `opsx-sync`)
3. `opencode.json` (o `.jsonc`) tiene los bloques `mcp.codegraph` y `mcp.engram` — sin campo `plugin`
4. `.codegraph/` existe en la raíz del proyecto (índice local de CodeGraph)
5. `engram --version` funciona y `engram setup opencode` ya fue ejecutado
6. **NO existen** archivos generados en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/` ni ningún directorio de otra plataforma

Reportá el estado de cada componente con ✓ o ✗.
