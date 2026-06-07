---
description: Instala CodeGraph, Superpowers y OpenSpec localmente para OpenCode únicamente
agent: build
---

Instala el stack tecnológico de desarrollo para este proyecto.

**RESTRICCIÓN ABSOLUTA:** instalar ÚNICAMENTE para OpenCode. Está terminantemente prohibido crear o modificar archivos en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/`, `.antigravity/`, `.windsurf/` o cualquier otro directorio de plataformas externas.

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

## Paso 2 — Superpowers

Lee el archivo `opencode.json` en la raíz del proyecto. Si no existe o no contiene el plugin de Superpowers, agrégalo.

El resultado final de `opencode.json` debe tener al menos:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]
}
```

Conserva cualquier otra configuración existente (no la reemplaces).

**IMPORTANTE:** modificar ÚNICAMENTE `opencode.json`. No crear ningún archivo fuera del directorio `.opencode/` ni de la raíz del proyecto.

---

## Paso 3 — OpenSpec

Inicializa OpenSpec configurándolo exclusivamente para OpenCode:

```bash
openspec init --tools opencode --force
```

El flag `--tools opencode` garantiza que solo se generen archivos en `.opencode/skills/` y `.opencode/commands/`. El flag `--force` limpia archivos legacy de inicializaciones anteriores que hayan podido configurar otras plataformas.

Si OpenSpec ya estaba correctamente inicializado para opencode, ejecuta en su lugar:

```bash
openspec update
```

**IMPORTANTE:** verificar después de la ejecución que no existan carpetas `.claude/`, `.kiro/`, `.cursor/` ni similares generadas por OpenSpec. Si existen, elimínalas.

---

## Verificación final

Confirma que:
1. `.opencode/` contiene los skills y comandos de OpenSpec (`openspec-*/SKILL.md`, `opsx-*.md`)
2. `opencode.json` tiene el plugin de Superpowers y la config del MCP de CodeGraph
3. `.codegraph/` existe en la raíz del proyecto (índice local de CodeGraph)
4. **NO existen** archivos generados en `.claude/`, `.kiro/`, `.cursor/`, `.gemini/`, `.codex/` ni ningún directorio de otra plataforma

Reporta el estado de cada componente con ✓ o ✗.
