---
description: Sincroniza los delta specs del change activo con la implementación
agent: build
---

Sincroniza los delta specs (`proposal.md` / `design.md` / `tasks.md`) del change activo en `openspec/changes/<name>/` con el estado actual de la implementación.

**Precondición:** existir un change activo bajo `openspec/changes/`.

Ejecutá el comando oficial de OpenSpec:

```bash
openspec update
```

Luego verificá que:

1. El change activo siga presente en `openspec/changes/<name>/`
2. Los archivos `proposal.md`, `design.md` y `tasks.md` reflejen el código real
3. No haya drift entre lo especificado y lo implementado

Reportá el estado final con ✓ o ✗.
