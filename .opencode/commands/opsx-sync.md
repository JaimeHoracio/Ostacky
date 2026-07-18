---
description: Sincroniza el grafo de CodeGraph y luego los delta specs del change activo con la implementación
agent: build
---

Sincroniza primero el grafo y luego los delta specs (`proposal.md` / `design.md` / `tasks.md`) del change activo en `openspec/changes/<name>/` con el estado actual de la implementación.

**Precondición:** existir un change activo bajo `openspec/changes/`.

Ejecutá los comandos en este orden:

```bash
codegraph init -i
codegraph sync
openspec update
```

Luego verificá que:

1. El grafo quedó actualizado con el estado real del código
2. El change activo sigue presente en `openspec/changes/<name>/`
3. Los archivos `proposal.md`, `design.md` y `tasks.md` reflejan el código real
4. No hay drift entre lo especificado y lo implementado

Reportá el estado final con ✓ o ✗.
