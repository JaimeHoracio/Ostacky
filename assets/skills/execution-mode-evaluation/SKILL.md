---
name: execution-mode-evaluation
description: Decide entre ejecución inline o subagent-driven según el análisis de CodeGraph. Úsalo cuando tengas tasks de implementación y necesites determinar el modo de ejecución óptimo.
license: MIT
compatibility: Requires CodeGraph MCP server and OpenSpec tasks.md
metadata:
  author: Ostacky
  version: "2.0"
---

**IMPORTANT:** Engram is an **MCP server**, not a skill. Tools `engram_mem_save`, `engram_mem_search`, `engram_mem_context` are MCP tools. Do NOT use `skill("engram")` — it doesn't exist.

# Skill: execution-mode-evaluation

Determinar el modo de ejecución óptimo entre **inline** y **subagent-driven** usando datos concretos de CodeGraph. La decisión sigue reglas estrictas en orden de precedencia.

## Input necesario

| Dato | Fuente | Obligatorio |
|------|--------|-------------|
| Tasks del change | `tasks.md` del cambio activo | ✅ |
| Archivos que modifica cada task | `codegraph_codegraph_explore` o lectura directa | ✅ |
| Blast radius por símbolo | `codegraph_codegraph_impact` | Para alta precisión |
| Contratos entre tasks | `design.md` | Para evaluar dependencias |

## Procedimiento

### Paso 0: Verificar discovery-cache primero (ÚNICO entrypoint)

**SHALL** llamar `src/discovery-cache.ts` `getDiscoverySnapshot(query)` y `getEngramDedup(query, requestId)` antes de cualquier `codegraph_codegraph_explore` o `engram_mem_search`. Si hit válido (TTL+gitDiffHash) → **reusar** `codegraph+engramHits` para construir `sharedFiles/fileClusters`; solo `codegraph_impact` para símbolos no cubiertos. Si miss o área difiere >30% → fetch fresco y `putDiscoverySnapshot`. Segunda llamada misma query en mismo `requestId` SHALL ser dedup (no `redundantCallCount`).

### Paso 0.1: Consultar Engram por decisiones previas (solo si no hay dedup hit)

Si `getEngramDedup` fue miss, `engram_mem_search` con keywords del cambio. Si existe decisión previa, usar como referencia no vinculante.

### Paso 0.5: Early exit para cambios pequeños

Si el change tiene **≤2 tasks** Y **no comparten archivos entre sí** → devolver directamente:

```json
{
  "recommendation": "INLINE",
  "reasons": ["Cambio pequeño (≤2 tasks independientes sin archivos compartidos)."],
  "codegraphUsed": [], "taskCount": <N>, "sharedFiles": {},
  "fileClusters": [<cada task como cluster>], "clusterCount": <taskCount>,
  "sequentialDeps": [], "estLines": <est>, "hasExplicitContract": false,
  "filesPerTask": {}, "globalRuleTriggered": "early-exit"
}
```

### Paso 1: Obtener datos de CodeGraph (solo si discovery-cache miss)

Si Paso 0 fue hit → **SKIP este paso**, derivar `fileClusters/sharedFiles` del snapshot (`state.snapshots.codegraph` + `tasks.md`). Snapshot resultante SHALL usar `codegraphUsed:["discovery-cache"]` (válido, no genera `WARN:execution_without_codegraph` si `snapshots.codegraph` existe) y `reuseDiscovery:true`.
Si miss:
```
codegraph_codegraph_explore con query: "<área del cambio>"
```
Si muy general → `codegraph_impact` para blast radius. Si CodeGraph no inicializado → `{ "recommendation": "INLINE", "confidence": 0.3, "reasons": ["CodeGraph no disponible"], "codegraphUsed": [] }`.

### Paso 2: Construir mapa de dependencias

```
taskCount:       total tasks de implementación
sharedFiles:     { archivo → [tasks que lo modifican] }
sequentialDeps:  [ [taskA, taskB], ... ]  // B necesita que A esté hecho
fileClusters:    componentes conectados por sharedFiles (cierre transitivo)
filesPerTask:    { task → [archivos que modifica] }
estLines:        estimación conservadora (~2-3 config, ~5-10 simple, ~15-30 complejo, ~10-20 tests)
```

**Detección de sequentialDeps:** buscar en tasks.md frases como "extender", "usar lo creado en", "depende de", "modificar el [módulo] de la task anterior".

### Paso 3a: Reglas de modo global (en orden, primera que se cumpla decide)

| # | Condición | Modo | Razón |
|---|-----------|------|-------|
| **1** | `clusterCount == 1` Y cluster tiene tamaño > 1 | INLINE | Todos comparten archivos en un único cluster — imposible paralelizar |
| **2a** | `clusterCount >= 2` Y hay deps entre clusters Y `hasExplicitContract == false` | INLINE | Deps secuenciales entre clusters sin contrato explícito |
| **2b** | `clusterCount >= 2` Y (NO hay deps entre clusters O contrato explícito) | SUBAGENT-DRIVEN | Cada cluster → 1 subagente. Tasks intra-cluster van secuenciales |
| **3a** | `clusterCount == taskCount` Y `taskCount < 3` | INLINE | Muy pocas tasks para amortizar overhead de subagentes |
| **3b** | `clusterCount == taskCount` Y `estLines < 30` | INLINE | Cambio pequeño — inline más eficiente en tokens |
| **3c** | `clusterCount == taskCount` (ninguna anterior) | SUBAGENT-DRIVEN | Tasks independientes — subagentes aíslan contexto |

**Excepción:** instrucciones explícitas del usuario ("hacé todo inline" / "usá subagentes") tienen prioridad total.

**Regla 2b — dispatch por clusters:** el subagente recibe el CLUSTER COMPLETO (no tasks individuales), las resuelve secuencialmente (comparten archivos). Diferentes clusters corren en paralelo.

### Paso 3b: Evaluación por fases (solo si modo global es INLINE)

Si global es SUBAGENT-DRIVEN → saltar (ya está granularizado por cluster).

Para cada fase de `tasks.md`, evaluar intra-fase:

| Condición | Modo fase |
|-----------|-----------|
| sharedFiles intra-fase > 0 | INLINE |
| sharedFiles con fases inline > 0 | INLINE |
| sequentialDeps intra-fase > 0 Y sin contrato | INLINE |
| taskCount fase < 4 | INLINE |
| estLines fase < 30 | INLINE |
| Ninguna anterior | SUBAGENT-DRIVEN |

**Orden de ejecución:** fases inline primero (establecen base), luego fases subagent-driven (consumen base).

### Paso 4: Output

**Snapshot para el controller (JSON):**

```json
{
  "recommendation": "INLINE" | "SUBAGENT_DRIVEN",
  "reasons": ["razón principal", "razón secundaria"],
  "codegraphUsed": ["codegraph_codegraph_explore"],
  "taskCount": <N>,
  "expectedTaskIds": ["T1", "T2", "T3"],
  "sharedFiles": { "src/archivo.ts": ["task1", "task2"] },
  "fileClusters": [["task1", "task2"], ["task3"]],
  "clusterCount": <N>,
  "sequentialDeps": [],
  "estLines": <N>,
  "hasExplicitContract": false,
  "filesPerTask": { "task1": ["src/archivo.ts"] },
  "globalRuleTriggered": "1" | "2a" | "2b" | "3a" | "3b" | "3c" | "early-exit",
  "phaseRecommendations": []
}
```

> **Nota 6.1:** `expectedTaskIds` es **obligatorio** cuando `taskCount>0` — el controller lo exige y rechaza snapshot sin él (excepto `early-exit` con `taskCount<=2` y `codegraphUsed:[]` que es válido sin WARN).
> Ejemplo early-exit válido: `{"recommendation":"INLINE","reasons":["Cambio pequeño"],"codegraphUsed":[],"taskCount":2,"expectedTaskIds":["T1","T2"],"globalRuleTriggered":"early-exit"}`

**Output para el usuario (mostrar en lenguaje natural):**

```markdown
## Análisis de modo de ejecución

**Recomendación:** INLINE / SUBAGENT_DRIVEN

### Archivos compartidos entre tasks
| Archivo | Tasks que lo modifican |
|---------|------------------------|
| `src/auth.ts` | task1, task2 |
| `src/utils.ts` | task3 |

### Clusters detectados
| Cluster | Tasks | Archivos |
|---------|-------|----------|
| A | task1, task2 | src/auth.ts |
| B | task3 | src/utils.ts |

### Dependencias secuenciales
- task2 depende de task1 (usa lo creado en)

### Razón principal
[Regla 2a]: Deps secuenciales entre clusters sin contrato explícito → INLINE

### Estimación
~45 líneas en 2 archivos
```

**Campos del snapshot (contrato con controller):**

| Campo | Descripción |
|-------|-------------|
| `recommendation` | `INLINE` o `SUBAGENT_DRIVEN` |
| `reasons` | Array — primera es la principal |
| `codegraphUsed` | Tools de CodeGraph ejecutados |
| `filesPerTask` | taskId → [archivos que modifica] |
| `sharedFiles` | archivo → [tasks que lo tocan] |
| `fileClusters` | Componentes conectados por sharedFiles |
| `clusterCount` | `== 1` todo conectado, `== taskCount` todo independiente |
| `sequentialDeps` | Dependencias secuenciales entre tasks |
| `estLines` | Estimación conservadora |
| `hasExplicitContract` | `true` si design.md explicita contratos |
| `expectedTaskIds` | **Obligatorio** cuando `taskCount>0` — gate del controller |
| `taskCount` | Total tasks, debe coincidir con `expectedTaskIds.length` |

**⚠️ Este skill provee ANÁLISIS, no autorización. Gate ANTES de persistir:** SHALL correr **en memoria primero**, derivar snapshot y **mostrar al usuario** `"Recomendación: INLINE/SUBAGENT por [razón], ~X líneas, clusters [...] ¿Procedo con este plan?"` y esperar. Solo si responde sí → `record_execution_analysis({snapshot, reuseDiscovery:true})` → `EXECUTION_DECISION_PENDING` → `consume_execution_decision`. Si responde no → `block({reason:"usuario rechazó plan"})` sin persistir. Si re-llamó `codegraph_explore` pudiendo reusar → `WARN:redundant_codegraph_call`.

## Ejemplo compacto

5 tasks, 3 clusters independientes (A: task1+task2 en `workflow.ts`, B: task3+task4 en `structured.ts`, C: task5 en archivo nuevo), sin deps entre clusters:

→ Rule 2b: SUBAGENT-DRIVEN. SA-1 ejecuta cluster A secuencial, SA-2 ejecuta cluster B secuencial, SA-3 ejecuta cluster C. Los 3 corren en paralelo. ✅

## Checklist

- [ ] Ejecuté `codegraph_codegraph_explore` (o verifiqué datos existentes)?
- [ ] Construí mapa de dependencias con `fileClusters`?
- [ ] Identifiqué clusters (componentes conectados)?
- [ ] Verifiqué deps ENTRE clusters (no solo intra)?
- [ ] Apliqué reglas en orden (1→2a/2b→3a/3b/3c)?
- [ ] Anoté `globalRuleTriggered`?
- [ ] Incluí `expectedTaskIds` (obligatorio cuando `taskCount>0`) y verifiqué que `taskCount == expectedTaskIds.length`?
- [ ] Si global es inline, ejecuté Paso 3b por fase?
- [ ] Si global es subagent por clusters (Rule 2b), documenté dispatch por clusters (máx 3 subagentes, advertir si `clusterCount>3` → oleadas)?
- [ ] Output es JSON válido con todos los campos del contrato?
- [ ] Early-exit con `codegraphUsed:[]` y `taskCount<=2` solo cuando realmente es cambio trivial (no genera WARN)?
