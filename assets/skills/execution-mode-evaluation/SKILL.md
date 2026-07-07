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

**Para estimar estLines:**
- Tasks de configuración/setup: ~2-3 líneas
- Tasks de implementación simple (agregar un enum, un flag): ~5-10 líneas
- Tasks de implementación compleja (nuevo módulo, lógica): ~15-30 líneas
- Tasks de tests: ~10-20 líneas
- Tasks de documentación: ~5-15 líneas

No es necesario ser exacto. Una estimación conservadora alcanza.

---

### Paso 3a: Modo global del cambio

Aplicar ESTRICTAMENTE en este orden. Evaluar cada condición. En la PRIMERA que se cumpla, esa es la decisión global.

```
1. SI sharedFiles tiene 1+ archivos compartidos entre 2+ tasks
   → INLINE (global)
   → Razón: "Archivos compartidos: {archivos}. Subagentes causarían conflictos de merge."

2. SI sequentialDeps tiene 1+ dependencias Y hasExplicitContract == false
   → INLINE (global)
   → Razón: "Dependencias secuenciales sin contrato explícito en design.md.
              Subagentes podrían definir contratos inconsistentes."
   
   EXCEPCIÓN: sequentialDeps pero hasExplicitContract == true
   → NO aplicar esta regla. Continuar a la siguiente.

3. SI taskCount < 4
   → INLINE (global)
   → Razón: "{taskCount} tasks. El overhead de dispatchear subagentes supera el beneficio."

4. SI estLines < 30
   → INLINE (global)
   → Razón: "Cambio pequeño (~{estLines} líneas). Inline es más eficiente en tokens."

5. SI NINGUNA condición anterior se cumplió
   → SUBAGENT-DRIVEN (global)
   → Razón: "{taskCount} tasks independientes sin archivos compartidos.
              Subagentes aíslan contexto y evitan saturación."
```

**Importante:** a diferencia de antes, NO saltear las reglas restantes al encontrar la primera. Anotar cuál regla se cumplió y por qué, pero CONTINUAR al Paso 3b para evaluar por fases. Solo si el modo global es SUBAGENT-DRIVEN (regla 5), saltear el Paso 3b porque no hay fases que optimizar.

**Excepción global:** si el usuario dio instrucciones EXPLÍCITAS sobre el modo de ejecución
("hacé todo inline", "usá subagentes"), esas instrucciones tienen PRIORIDAD TOTAL sobre estas reglas. En ese caso, todas las fases heredan el modo del usuario.

---

### Paso 3b: Evaluación por fases (solo si el modo global es inline)

Si el modo global es SUBAGENT-DRIVEN (regla 5), saltear este paso — todas las fases van como subagentes.

Si el modo global es INLINE (reglas 1-4), evaluar CADA FASE de `tasks.md` por separado para determinar si alguna puede ejecutarse como subagentes independientes.

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
  "globalRuleTriggered": 1,
  "taskAnalysis": {
    "taskCount": 13,
    "sharedFiles": {
      "src/logging.ts": ["2.2", "2.4", "2.5"]
    },
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
| `globalRuleTriggered` | Número de la regla que decidió el modo global (1-5). Para trazabilidad. |
| `taskAnalysis` | Mapa global construido en el Paso 2. Incluir siempre para trazabilidad. |
| `phaseRecommendations` | Array con el modo recomendado por fase. Cada entrada tiene `phase`, `mode` y `reason`. Vacío si el modo global es subagent-driven o si tasks.md no tiene fases separadas. |

---

## Ejemplos

### Ejemplo 1: Multicapa — archivos compartidos, fases independientes

**Input:** change `update-ostacky-5-levels`
- Fase 2: 5 tasks de implementación (algunas comparten `src/logging.ts`)
- Fase 4: 4 tests independientes en `tests/*.ts`
- ~143 líneas totales

**Decisión:**

```json
{
  "mode": "inline",
  "confidence": 0.95,
  "reasons": [
    "Archivos compartidos: src/logging.ts (tasks 2.2, 2.4, 2.5). Subagentes causarían conflictos de merge.",
    "Dependencias secuenciales: 2.1→2.2→2.4/2.5 sin contrato explícito en design.md."
  ],
  "codegraphUsed": ["codegraph_context", "codegraph_search"],
  "globalRuleTriggered": 1,
  "taskAnalysis": {
    "taskCount": 13,
    "sharedFiles": {
      "src/logging.ts": ["2.2", "2.4", "2.5"],
      "src/cli.ts": ["2.3", "3.1"]
    },
    "sequentialDeps": [["2.1", "2.2"], ["2.2", "2.4"], ["2.2", "2.5"], ["2.1", "2.3"]],
    "estLines": 143,
    "hasExplicitContract": false
  },
  "phaseRecommendations": [
    {
      "phase": "2. Core Implementation",
      "mode": "inline",
      "reason": "Archivos compartidos dentro de la fase: src/logging.ts, src/cli.ts"
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

### Ejemplo 2: Cambio chico sin fases

**Input:**
- 3 tasks
- Archivos diferentes
- Sin dependencias

**Decisión:**

```json
{
  "mode": "inline",
  "confidence": 0.85,
  "reasons": [
    "3 tasks. El overhead de dispatchear subagentes supera el beneficio."
  ],
  "codegraphUsed": [],
  "globalRuleTriggered": 3,
  "taskAnalysis": {
    "taskCount": 3,
    "sharedFiles": {},
    "sequentialDeps": [],
    "estLines": 20,
    "hasExplicitContract": false
  },
  "phaseRecommendations": []
}
```

### Ejemplo 3: Tasks globalmente independientes

**Input:**
- 8 tasks, cada una en su propio archivo
- Sin dependencias secuenciales
- ~120 líneas totales

**Decisión:**

```json
{
  "mode": "subagent-driven",
  "confidence": 0.9,
  "reasons": [
    "8 tasks independientes sin archivos compartidos. Subagentes evitan saturación de contexto."
  ],
  "codegraphUsed": ["codegraph_context"],
  "globalRuleTriggered": 5,
  "taskAnalysis": {
    "taskCount": 8,
    "sharedFiles": {},
    "sequentialDeps": [],
    "estLines": 120,
    "hasExplicitContract": false
  },
  "phaseRecommendations": []
}
```

---

## Reglas complementarias

- **Fases sin tasks de implementación:** si una fase solo tiene tasks de documentación, release o configuración, evaluar igual pero con sesgo a inline (regla 3 y 4 suelen gatillar para fases de 1-3 tasks).

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
- [ ] ¿Construí el mapa de dependencias GLOBAL (Paso 2)?
- [ ] ¿Apliqué las reglas globales en orden? (1 → 2 → 3 → 4 → 5)
- [ ] ¿Anoté cuál regla global se gatilló?
- [ ] ¿Si el modo global es inline, ejecuté el Paso 3b por cada fase?
- [ ] ¿Para cada fase evalué sharedFiles intra-fase Y cross-fase?
- [ ] ¿El usuario dio instrucciones explícitas que anulen las reglas?
- [ ] ¿El output es JSON válido con todos los campos incluyendo `phaseRecommendations`?
