---
name: execution-mode-evaluation
description: Decide entre ejecución inline o subagent-driven según el análisis de CodeGraph. Úsalo cuando tengas tasks de implementación y necesites determinar el modo de ejecución óptimo.
license: MIT
compatibility: Requires CodeGraph MCP server and OpenSpec tasks.md
metadata:
  author: Ostacky
  version: "1.0"
---

# Skill: execution-mode-evaluation

## Propósito

Determinar el modo de ejecución óptimo entre **inline** y **subagent-driven** para un cambio, usando datos concretos de CodeGraph (no especulación del modelo). La decisión sigue reglas estrictas en orden de precedencia.

## Input necesario

El modelo DEBE tener disponible en contexto (o accesible vía el procedimiento):

| Dato | Fuente | Obligatorio |
|------|--------|-------------|
| Tasks del change | `tasks.md` del cambio activo | ✅ Sí |
| Archivos que modifica cada task | `codegraph_context` o lectura directa de tasks | ✅ Sí |
| Relaciones entre símbolos | `codegraph_context` | Recomendado |
| Blast radius por símbolo | `codegraph_impact` | Para alta precisión |
| Contratos explícitos entre tasks | `design.md` | Para evaluar dependencias |

## Procedimiento

Seguir los pasos en orden. No saltear ni reordenar.

---

### Paso 0: Verificar datos existentes en contexto

Revisá el contexto actual de la sesión.

**Si ya tenés disponible:**
- El output de `codegraph_context` para el área del cambio **Y**
- Ese output incluye los archivos específicos que cada task modifica

→ **Saltá el Paso 1.** Usá los datos que ya están en contexto.

**Si no los tenés, o tenés dudas sobre su completitud:**
→ Ejecutá el Paso 1.

**Regla:** si el `codegraph_context` que tenés solo dio una visión general pero no alcanza a distinguir archivos por task, no es suficiente. Ejecutá de nuevo.

---

### Paso 1: Obtener datos de CodeGraph

Ejecutá esta consulta:

```
codegraph_context con task: "<descripción del cambio>"
```

Buscá específicamente en el output:
- Lista de archivos involucrados
- Símbolos principales y sus archivos
- Relaciones (quién importa a quién, quién extiende a quién)

**Si el output es muy general o no distingue archivos por task:**

Ejecutá `codegraph_impact` sobre los símbolos centrales que aparezcan en el output. Esto te da el blast radius preciso de cada símbolo (qué archivos se rompen si lo cambiás).

**Si CodeGraph reporta que el proyecto no está inicializado:**

→ DEVOLVÉ: `{ "mode": "inline", "confidence": 0.3, "reasons": ["CodeGraph no disponible - fallback a inline"], "codegraphUsed": [] }`

No bloquees. En proyectos sin CodeGraph, la decisión por defecto es inline.

---

### Paso 2: Construir mapa de dependencias

Con tasks.md + datos de CodeGraph, construí este mapa:

```
taskCount:       número total de tasks (solo las de implementación)
sharedFiles:     { archivo -> [tasks que lo modifican] }
sequentialDeps:  [ [taskA, taskB], ... ]  // B necesita que A esté hecho
fileClusters:    [ ["taskA", "taskB"], ["taskC"], ... ]  // componentes conectados por archivos compartidos
filesPerTask:    { task -> [archivos que modifica] }
estLines:        estimación conservadora de líneas totales de cambio
hasExplicitContract: true/false  // design.md especifica contratos entre tasks?
```

**Para detectar sharedFiles:**
- Si dos tasks mencionan modificar el mismo archivo → sharedFile.
- Usá `codegraph_impact` si hay dudas sobre qué archivos toca cada símbolo.

**Para detectar sequentialDeps:**
- Buscá en tasks.md frases como: "extender", "usar lo creado en", "modificar el [módulo] de la task anterior", "depende de".
- Si task B dice "Update [X] to handle [Y]" y task A dice "Add [Y] to [X]" → dependencia secuencial.
- Si el diseño (design.md) explicita contratos (interfaces, tipos compartidos), la dependencia es manejable con subagentes.

**Para construir fileClusters (clusters por archivos compartidos):**
- Usar `sharedFiles` para agrupar tareas en clusters (componentes conectados del grafo).
- Inicializar: cada tarea es su propio cluster.
- Para cada archivo en `sharedFiles`: todas las tasks que modifican ese archivo → mismo cluster.
- Aplicar cierre transitivo: si taskA comparte archivo con taskB, y taskB con taskC, entonces A/B/C están en el mismo cluster.
- El resultado son los grupos de tareas que comparten archivos entre sí.
- Un cluster de tamaño 1 significa que esa task NO comparte archivos con ninguna otra.
- `clusterCount == taskCount` → no hay archivos compartidos en absoluto.
- `clusterCount == 1` → todas las tareas están conectadas por archivos compartidos.

**Para estimar estLines:**
- Tasks de configuración/setup: ~2-3 líneas
- Tasks de implementación simple (agregar un enum, un flag): ~5-10 líneas
- Tasks de implementación compleja (nuevo módulo, lógica): ~15-30 líneas
- Tasks de tests: ~10-20 líneas
- Tasks de documentación: ~5-15 líneas

No es necesario ser exacto. Una estimación conservadora alcanza.

---

### Paso 3a: Modo global del cambio — basado en clusters

Antes de aplicar reglas, construir CLUSTERS de tareas por archivos compartidos usando `sharedFiles` y `fileClusters` del Paso 2.

**Construcción de clusters (componentes conectados):**
1. Inicializar: cada tarea es su propio cluster de tamaño 1.
2. Para cada archivo en `sharedFiles`: todas las tasks que modifican ese archivo → mismo cluster.
3. Cierre transitivo: si taskA comparte archivo con taskB, y taskB comparte archivo con taskC, entonces A/B/C están en el mismo cluster.
4. Resultado: componentes conectados del grafo "tareas que comparten archivos".

```
Ejemplo:
  task1 y task2 modifican workflow-factories.ts → cluster [task1, task2]
  task3 y task4 modifican structured-call.ts    → cluster [task3, task4]
  task5 modifica tests/unit.test.ts             → cluster [task5]
  
  clusterCount: 3
  clusters independientes entre sí: ✅ (cada uno en sus archivos)
```

Luego aplicar estas reglas en orden. La PRIMERA que se cumpla decide el modo global:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. clusterCount == 1 Y cluster tiene tamaño > 1                │
│     → INLINE (global)                                           │
│     → globalRuleTriggered: "1"                                  │
│     → Razón: "Todas las tareas comparten archivos en un único   │
│               cluster ({N} tasks). Imposible paralelizar sin    │
│               conflictos de merge."                             │
│     → Continuar al Paso 3b para evaluar por fases.              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  2. clusterCount >= 2 Y hay clusters con tamaño > 1             │
│     (hay archivos compartidos, pero en grupos independientes)    │
│                                                                 │
│     → Verificar dependencias secuenciales ENTRE clusters:       │
│       Si sequentialDeps contiene [taskA, taskB] donde A∈clusterX,│
│       B∈clusterY, X≠Y → hay deps entre clusters.               │
│       Deps INTRA-cluster (A y B en mismo cluster) no afectan.   │
│                                                                 │
│     a. SI hay deps entre clusters Y hasExplicitContract == false │
│        → INLINE (global)                                        │
│        → globalRuleTriggered: "2a"                              │
│        → Razón: "{clusterCount} clusters pero con dependencias  │
│                  secuenciales entre clusters sin contrato        │
│                  explícito en design.md."                       │
│        → Continuar al Paso 3b para evaluar por fases.           │
│                                                                 │
│     b. SI NO (clusters sin deps entre sí, O contrato explícito) │
│        → SUBAGENT-DRIVEN (global), CADA CLUSTER como unidad     │
│          de subagente. Tasks dentro del mismo cluster se        │
│          ejecutan secuencialmente (comparten archivos).         │
│        → globalRuleTriggered: "2b"                              │
│        → Razón: "{clusterCount} clusters independientes sin     │
│                  archivos compartidos entre clusters. Cada       │
│                  cluster → 1 subagente."                        │
│        → Saltar Paso 3b (granularidad ya está por cluster).     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  3. NO hay archivos compartidos (clusterCount == taskCount,     │
│     todos los clusters son de tamaño 1)                         │
│                                                                 │
│     a. SI taskCount < 3                                         │
│        → INLINE (global)                                        │
│        → globalRuleTriggered: "3a"                              │
│        → Razón: "{taskCount} tasks independientes pero muy      │
│                  pocas para amortizar overhead de subagentes."   │
│        → Continuar al Paso 3b para evaluar por fases.           │
│                                                                 │
│     b. SI estLines < 30                                         │
│        → INLINE (global)                                        │
│        → globalRuleTriggered: "3b"                              │
│        → Razón: "Cambio pequeño (~{estLines} líneas). Inline    │
│                  más eficiente en tokens."                      │
│        → Continuar al Paso 3b para evaluar por fases.           │
│                                                                 │
│     c. SI NINGUNA condición anterior                            │
│        → SUBAGENT-DRIVEN (global), cada task como subagente     │
│        → globalRuleTriggered: "3c"                              │
│        → Razón: "{taskCount} tasks independientes sin archivos  │
│                  compartidos. Subagentes aíslan contexto."       │
│        → Saltar Paso 3b.                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Excepción global:** si el usuario dio instrucciones EXPLÍCITAS sobre el modo de ejecución
("hacé todo inline", "usá subagentes"), esas instrucciones tienen PRIORIDAD TOTAL sobre estas reglas. En ese caso, todas las fases heredan el modo del usuario.

**Nota sobre subagentes con clusters (Rule 2b):** Cuando el modo global es SUBAGENT-DRIVEN por clusters, cada cluster se convierte en una unidad de trabajo atómica para un subagente. El subagente NO recibe tasks individuales sino el CLUSTER COMPLETO, y las resuelve secuencialmente (porque comparten archivos). Diferentes clusters se ejecutan en paralelo porque NO comparten archivos entre sí.

**Nota sobre deps entre clusters (Rule 2a):** Es raro pero posible. Por ejemplo, task1 en archivo A, task2 en archivo B, task3 en archivo A (hereda/depende de task1). Los clusters son [task1, task3] y [task2]. clusterCount=2 pero task3 depende de task1. Si no hay contrato explícito en design.md, el riesgo es alto → inline.

---

### Paso 3b: Evaluación por fases (solo si el modo global es inline)

Si el modo global es SUBAGENT-DRIVEN, saltear este paso — todas las fases van como subagentes (o clusters completos como subagentes si aplica Rule 2b).

Si el modo global es INLINE, evaluar CADA FASE de `tasks.md` por separado para determinar si alguna puede ejecutarse como subagentes independientes.

**Para cada fase en tasks.md:**

1. Extraer solo las tasks de esa fase.
2. Construir un mapa reducido: sharedFiles intra-fase, sequentialDeps intra-fase, taskCount de la fase, estLines de la fase.
3. Verificar si las tasks de esta fase comparten archivos con tasks de fases que van inline (usar el mapa global del Paso 2).
4. Aplicar estas reglas en orden. La PRIMERA que se cumpla decide el modo de la fase:

```
a. SI sharedFiles intra-fase > 0
   → INLINE para esta fase
   → Razón: "Archivos compartidos dentro de la fase: {archivos}."

b. SI sharedFiles con fases inline > 0
   → INLINE para esta fase
   → Razón: "Comparte archivos con fase inline: {archivos}. Riesgo de conflictos cross-fase."

c. SI sequentialDeps intra-fase > 0 Y hasExplicitContract == false
   → INLINE para esta fase
   → Razón: "Dependencias secuenciales sin contrato explícito."

d. SI taskCount de la fase < 4
   → INLINE para esta fase
   → Razón: "{N} tasks en la fase. Overhead de subagentes no se amortiza."

e. SI estLines de la fase < 30
   → INLINE para esta fase
   → Razón: "Fase pequeña (~{N} líneas). Inline más eficiente."

f. SI NINGUNA condición anterior se cumplió
   → SUBAGENT-DRIVEN para esta fase
   → Razón: "{N} tasks independientes sin archivos compartidos."
```

**Output del Paso 3b:** una recomendación por fase. No modifica el modo global, pero le da al coordinador un plan de ejecución granular.

---

### Paso 4: Devolver decisión

El output DEBE ser un JSON válido en este formato:

```json
{
  "mode": "inline" | "subagent-driven",
  "confidence": 0.0 - 1.0,
  "reasons": ["razón principal", "razón secundaria"],
  "codegraphUsed": ["codegraph_context"],
  "globalRuleTriggered": "1",
  "taskAnalysis": {
    "taskCount": 13,
    "sharedFiles": {
      "src/logging.ts": ["2.2", "2.4", "2.5"]
    },
    "fileClusters": [
      ["2.2", "2.4", "2.5"],
      ["2.1"],
      ["2.3"],
      ["3.1"]
    ],
    "clusterCount": 4,
    "sequentialDeps": [],
    "estLines": 45,
    "hasExplicitContract": false
  },
  "phaseRecommendations": [
    {
      "phase": "2. Core Implementation",
      "mode": "inline",
      "reason": "Archivos compartidos dentro de la fase: src/logging.ts"
    },
    {
      "phase": "4. Testing",
      "mode": "subagent-driven",
      "reason": "4 tests independientes sin archivos compartidos"
    }
  ]
}
```

**Campos:**

| Campo | Descripción |
|-------|-------------|
| `mode` | Modo global: `inline` o `subagent-driven` |
| `confidence` | Qué tan seguro estás de la decisión (0.0 = nada, 1.0 = totalmente). Bajar si CodeGraph no se pudo usar. |
| `reasons` | Array de strings. La primera razón es la principal (por qué se gatilló la regla global). |
| `codegraphUsed` | Lista de tool calls de CodeGraph que se ejecutaron. Vacío si el Paso 0 encontró datos suficientes. |
| `globalRuleTriggered` | Código de la regla que decidió el modo global ("1", "2a", "2b", "3a", "3b", "3c"). Para trazabilidad. |
| `taskAnalysis` | Mapa global construido en el Paso 2. Incluir siempre para trazabilidad. |
| `taskAnalysis.fileClusters` | Array de arrays: cada sub-array es un cluster de tareas que comparten archivos. Fundamental para la decisión. |
| `taskAnalysis.clusterCount` | Número total de clusters. `clusterCount == 1` → todo conectado. `clusterCount == taskCount` → todo independiente. |
| `phaseRecommendations` | Array con el modo recomendado por fase. Cada entrada tiene `phase`, `mode` y `reason`. Vacío si el modo global es subagent-driven o si tasks.md no tiene fases separadas. |

---

## Ejemplos

### Ejemplo 1: Multicapa — clusters conectados, dependencias entre clusters

**Input:** change `update-ostacky-5-levels`
- Fase 2: 5 tasks de implementación
  - Tasks 2.2, 2.4, 2.5 comparten `src/logging.ts` → cluster A
  - Tasks 2.3 y 3.1 comparten `src/cli.ts` → cluster B (cross-fase)
  - Task 2.1 tiene archivo propio
  - Dependencias: 2.1→2.2→2.4/2.5, 2.1→2.3 (deps ENTRE clusters)
- Fase 4: 4 tests independientes en `tests/*.ts`
- ~143 líneas totales

**Análisis de clusters:**
- cluster [2.2, 2.4, 2.5] (comparten logging.ts)
- cluster [2.3, 3.1] (comparten cli.ts)
- cluster [2.1], cluster resto de tests, etc.
- Hay dependencias secuenciales ENTRE clusters (2.1→cluster A, 2.1→cluster B) sin contrato explícito
- → Rule 2a: INLINE global (deps entre clusters sin contrato)

**Decisión:**

```json
{
  "mode": "inline",
  "confidence": 0.95,
  "reasons": [
    "5 clusters pero con dependencias secuenciales entre clusters sin contrato explícito en design.md.",
    "Archivos compartidos dentro de clusters: src/logging.ts, src/cli.ts."
  ],
  "codegraphUsed": ["codegraph_context", "codegraph_search"],
  "globalRuleTriggered": "2a",
  "taskAnalysis": {
    "taskCount": 13,
    "sharedFiles": {
      "src/logging.ts": ["2.2", "2.4", "2.5"],
      "src/cli.ts": ["2.3", "3.1"]
    },
    "fileClusters": [
      ["2.2", "2.4", "2.5"],
      ["2.3", "3.1"],
      ["2.1"],
      ["4.1"],
      ["4.2"],
      ["4.3"],
      ["4.4"],
      ["3.2"],
      ["5.1"],
      ["5.2"]
    ],
    "clusterCount": 10,
    "sequentialDeps": [["2.1", "2.2"], ["2.2", "2.4"], ["2.2", "2.5"], ["2.1", "2.3"]],
    "estLines": 143,
    "hasExplicitContract": false
  },
  "phaseRecommendations": [
    {
      "phase": "2. Core Implementation",
      "mode": "inline",
      "reason": "Archivos compartidos dentro de la fase: src/logging.ts, src/cli.ts. Además tiene dependencias entre clusters sin contrato."
    },
    {
      "phase": "3. Documentation",
      "mode": "inline",
      "reason": "2 tasks en la fase. Overhead de subagentes no se amortiza."
    },
    {
      "phase": "4. Testing",
      "mode": "subagent-driven",
      "reason": "4 tests independientes sin archivos compartidos entre sí ni con fase inline."
    },
    {
      "phase": "5. Release & Cleanup",
      "mode": "inline",
      "reason": "2 tasks en la fase. Overhead de subagentes no se amortiza."
    }
  ]
}
```

### Ejemplo 2: Cambio chico sin archivos compartidos

**Input:**
- 3 tasks en archivos diferentes
- Sin dependencias secuenciales
- ~20 líneas totales

**Análisis de clusters:**
- clusterCount == taskCount == 3 (todos los clusters son tamaño 1 — sin archivos compartidos)
- Rule 3a: 3 < 3? No → skip
- Rule 3b: 20 < 30? Sí → INLINE

**Decisión:**

```json
{
  "mode": "inline",
  "confidence": 0.85,
  "reasons": [
    "Cambio pequeño (~20 líneas). Inline más eficiente en tokens."
  ],
  "codegraphUsed": [],
  "globalRuleTriggered": "3b",
  "taskAnalysis": {
    "taskCount": 3,
    "sharedFiles": {},
    "fileClusters": [
      ["task1"],
      ["task2"],
      ["task3"]
    ],
    "clusterCount": 3,
    "sequentialDeps": [],
    "estLines": 20,
    "hasExplicitContract": false
  },
  "phaseRecommendations": []
}
```

### Ejemplo 3: Tasks globalmente independientes (sin archivos compartidos)

**Input:**
- 8 tasks, cada una en su propio archivo
- Sin dependencias secuenciales
- ~120 líneas totales

**Análisis de clusters:**
- clusterCount == taskCount == 8 (sin archivos compartidos)
- Rule 3a: 8 < 3? No → skip
- Rule 3b: 120 < 30? No → skip
- Rule 3c: → SUBAGENT-DRIVEN

**Decisión:**

```json
{
  "mode": "subagent-driven",
  "confidence": 0.9,
  "reasons": [
    "8 tasks independientes sin archivos compartidos. Subagentes aíslan contexto y evitan saturación."
  ],
  "codegraphUsed": ["codegraph_context"],
  "globalRuleTriggered": "3c",
  "taskAnalysis": {
    "taskCount": 8,
    "sharedFiles": {},
    "fileClusters": [
      ["task1"],
      ["task2"],
      ["task3"],
      ["task4"],
      ["task5"],
      ["task6"],
      ["task7"],
      ["task8"]
    ],
    "clusterCount": 8,
    "sequentialDeps": [],
    "estLines": 120,
    "hasExplicitContract": false
  },
  "phaseRecommendations": []
}
```

### Ejemplo 4: Clusters independientes — el fix del bug (Rule 2b)

Este es el escenario exacto que el diseño anterior NO manejaba correctamente.

**Input:**
- 5 tasks
- Task 1 y Task 2 modifican `src/workflow-factories.ts` → cluster A
- Task 3 y Task 4 modifican `src/structured-call.ts` → cluster B
- Task 5 crea archivo nuevo `tests/workflow.test.ts` → cluster C
- Sin dependencias secuenciales entre clusters
- ~85 líneas totales

**Análisis de clusters:**
- cluster A: [task1, task2] — comparten `workflow-factories.ts`
- cluster B: [task3, task4] — comparten `structured-call.ts`
- cluster C: [task5] — archivo propio
- clusterCount = 3, hay clusters con tamaño > 1
- NO hay dependencias secuenciales ENTRE clusters
- → Rule 2b: SUBAGENT-DRIVEN con cluster dispatch

**Output:**

```json
{
  "mode": "subagent-driven",
  "confidence": 0.95,
  "reasons": [
    "3 clusters independientes sin archivos compartidos entre clusters. Cada cluster → 1 subagente.",
    "Cluster A (tasks 1-2), Cluster B (tasks 3-4), Cluster C (task 5)."
  ],
  "codegraphUsed": ["codegraph_context"],
  "globalRuleTriggered": "2b",
  "taskAnalysis": {
    "taskCount": 5,
    "sharedFiles": {
      "src/workflow-factories.ts": ["task1", "task2"],
      "src/structured-call.ts": ["task3", "task4"]
    },
    "fileClusters": [
      ["task1", "task2"],
      ["task3", "task4"],
      ["task5"]
    ],
    "clusterCount": 3,
    "sequentialDeps": [],
    "estLines": 85,
    "hasExplicitContract": false
  },
  "phaseRecommendations": []
}
```

**¿Cómo se ejecuta?**

| Subagente | Cluster | Tasks | Ejecución |
|-----------|---------|-------|-----------|
| SA-1 | A | task1, task2 | Secuencial (comparten archivo) |
| SA-2 | B | task3, task4 | Secuencial (comparten archivo) |
| SA-3 | C | task5 | Directa (archivo nuevo) |

Los 3 subagentes corren en paralelo. NO hay conflictos de merge porque ningún archivo es tocado por más de un subagente. ✨

---

## Reglas complementarias

- **Fases sin tasks de implementación:** si una fase solo tiene tasks de documentación, release o configuración, evaluar igual pero con sesgo a inline (reglas 3a/3b o d/e suelen gatillar para fases de 1-3 tasks).

- **Orden de ejecución:** las fases con modo inline deben ejecutarse PRIMERO que las fases subagent-driven, porque las fases inline establecen los contratos (interfaces, tipos, módulos) que las fases subagent-driven consumen. Documentar el orden en `phaseRecommendations` incluyendo un orden sugerido de ejecución.

- **CodeGraph no disponible:** si el proyecto target no tiene CodeGraph inicializado, la decisión por defecto es inline global con confianza baja (0.3). No bloquear. Saltar Paso 3b.

- **Prioridad del usuario:** si el usuario explicitó el modo ("usá subagentes", "hacé todo inline"), esa instrucción anula cualquier decisión de este skill. Todas las fases heredan ese modo.

- **Re-evaluación:** si se agregan tasks a mitad del cambio, re-ejecutar este skill. Las condiciones pueden cambiar (nuevas fases, sharedFiles que aparecen o desaparecen).

## Orden de ejecución recomendado

Cuando hay `phaseRecommendations`, seguir este orden:

1. Ejecutar todas las fases marcadas como **inline** primero (establecen la base)
2. Después ejecutar las fases marcadas como **subagent-driven** (consumen la base)
3. Si una fase subagent-driven depende de los resultados de otra fase subagent-driven, ejecutarlas secuencialmente respetando el orden de fases en tasks.md

## Checklist de verificación

- [ ] ¿Ejecuté o verifiqué `codegraph_context`?
- [ ] ¿Construí el mapa de dependencias GLOBAL (Paso 2) incluyendo `fileClusters`?
- [ ] ¿Identifiqué los clusters (componentes conectados por archivos compartidos)?
- [ ] ¿Verifiqué dependencias secuenciales ENTRE clusters (no solo intra-cluster)?
- [ ] ¿Apliqué las reglas en orden? (1 → 2a/2b → 3a/3b/3c)
- [ ] ¿Anoté cuál regla global se gatilló (código exacto: "1", "2a", "2b", "3a", "3b", "3c")?
- [ ] ¿Si el modo global es inline (Rule 1, 2a, 3a, 3b), ejecuté el Paso 3b por cada fase?
- [ ] ¿Para cada fase evalué sharedFiles intra-fase Y cross-fase?
- [ ] ¿Si el modo global es subagent-driven por clusters (Rule 2b), documenté qué cluster va a cada subagente?
- [ ] ¿El usuario dio instrucciones explícitas que anulen las reglas?
- [ ] ¿El output es JSON válido con todos los campos: `mode`, `confidence`, `reasons`, `globalRuleTriggered`, `taskAnalysis.fileClusters`, `taskAnalysis.clusterCount`, `phaseRecommendations`?
