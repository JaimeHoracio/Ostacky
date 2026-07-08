# execution-mode-evaluation

Decide entre ejecución **inline** o **subagent-driven** según datos concretos de CodeGraph. Evaluación multicapa: modo global + recomendaciones por fase.

---

## Contexto de uso

El skill se carga dentro del flujo del agente Ostacky, específicamente en la etapa **Execution** cuando el cambio requiere una decisión informada (Nivel 1+ o Nivel 0+1 con spec):

```
                    ┌──────────────┐
                    │  USER REQUEST │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │ 1. DISCOVERY │
                    │ (CodeGraph)  │
                    └──────┬───────┘
                           ▼
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌────────────────┐       ┌──────────────────┐
     │  Nivel 0       │       │  Nivel 0+1       │
     │  trivial       │       │                   │
     └───────┬────────┘       └────────┬──────────┘
             ▼                         ▼
     Inline directo           ┌────┴────┐
                              ▼         ▼
                        OpenSpec    Directo
                           │           │
                           ▼           ▼
                     ┌──────────┐  Inline directo
                     │ Planning │  (sin skill)
                     └────┬─────┘
                          ▼
                    ┌──────────────┐
                    │  Nivel 1+    │
                    │  (OpenSpec)  │
                    └──────┬───────┘
                           ▼
              ┌────────────────────────┐
              │ 4. EXECUTION           │
              │                        │
              │ ┌── 1. Cargar SKILL ──┐│
              │ │   Skill tool ->     ││ <- FORZOSO
              │ │   execution-mode-   ││
              │ │   evaluation        ││
              │ └─────────────────────┘│
              │ ┌  NO CONTINUAR       ┐│
              │ │  SIN OUTPUT JSON    ││
              │ └─────────────────────┘│
              │                        │
              │ 2. Elegir modo segun   │
              │    output del skill    │
              │                        │
              │ 3. Ejecutar            │
              └────────────────────────┘
```

---

## Flujo completo del skill

Los pasos que ejecuta el skill una vez cargado:

```
┌──────────────────────────────────────────────────────────────┐
│                   1. GATILLO                                 │
│                                                              │
│  Agent definition (ostacky.md) dice:                         │
│  "Cargar AHORA el skill execution-mode-evaluation"           │
│  "No continuar sin el output JSON"                           │
│                                                              │
│  → Se invoca el Skill tool → se carga este SKILL.md         │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   2. PASO 0 — CHECK DE DATOS                 │
│                                                              │
│  ¿Ya hay codegraph_context en el contexto de la sesión?      │
│  ├── SÍ y tiene los archivos por task → saltar Paso 1       │
│  └── NO o incompleto → continuar a Paso 1                   │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   3. PASO 1 — CODEGRAPH (si necesario)       │
│                                                              │
│  Ejecutar codegraph_context sobre el área del cambio         │
│  Buscar: archivos, símbolos, relaciones                     │
│                                                              │
│  Si hace falta más precisión: codegraph_impact               │
│                                                              │
│  Si CodeGraph no disponible: fallback a inline con conf 0.3  │
│                                                              │
│  Output: datos de archivos y símbolos involucrados           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   4. PASO 2 — MAPA DE DEPENDENCIAS           │
│                                                              │
│  Se construye con tasks.md + datos de CodeGraph:             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ taskCount:     cantidad total de tasks               │     │
│  │ sharedFiles:   { archivo → [tasks que lo modifican] }│     │
│  │ fileClusters:  [ [taskA,taskB], [taskC], ... ]       │     │
│  │ clusterCount:  cantidad de clusters                  │     │
│  │ sequentialDeps: [taskA → taskB]                      │     │
│  │ filesPerTask:  { task → [archivos] }                 │     │
│  │ estLines:      líneas estimadas de cambio            │     │
│  │ hasExplicitContract: diseño explícita contratos?     │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   5. PASO 3a — MODO GLOBAL                   │
│                                                              │
│  PRIMERO: CONSTRUIR CLUSTERS (componentes conectados)        │
│  - sharedFiles agrupa tareas que modifican los mismos archs  │
│  - Cierre transitivo: A comparte archivo con B, B con C     │
│    → A, B, C están en el mismo cluster                      │
│  - clusterCount: cantidad total de clusters                 │
│                                                              │
│  LUEGO: evaluar en orden:                                    │
│                                                              │
│  1. clusterCount==1 y tamaño>1?                    → INLINE  │
│     (todo comparte archivos, no se puede paralelizar)        │
│                                                              │
│  2. clusterCount>=2, clusters con tamaño>1?                  │
│     a. ¿deps ENTRE clusters sin contrato?         → INLINE   │
│     b. ¿NO? → SUBAGENT-DRIVEN (cada cluster=1 subagente)     │
│                                                              │
│  3. Sin archivos compartidos (clusterCount==taskCount):      │
│     a. ¿taskCount < 3?                            → INLINE   │
│     b. ¿estLines < 30?                            → INLINE   │
│     c. ¿ninguna? → SUBAGENT-DRIVEN (cada task=1 subagente)   │
│                                                              │
│  Si el usuario dio instrucciones explícitas:                 │
│  → anulan todas las reglas, todas las fases heredan el modo  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│            6. PASO 3b — EVALUACIÓN POR FASES                 │
│            (solo si el modo global es INLINE)                │
│                                                              │
│  Si el modo global es SUBAGENT-DRIVEN (Rule 2b o 3c)        │
│  → saltar este paso (ya hay granularidad por cluster/task)  │
│                                                              │
│  Por cada fase en tasks.md:                                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ a. ¿sharedFiles DENTRO de la fase?      → INLINE     │     │
│  │ b. ¿sharedFiles con fases INLINE?       → INLINE     │     │
│  │ c. ¿sequentialDeps sin contrato?        → INLINE     │     │
│  │ d. ¿taskCount < 4?                      → INLINE     │     │
│  │ e. ¿estLines < 30?                      → INLINE     │     │
│  │ f. Ninguna de las anteriores → SUBAGENT-DRIVEN       │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Output: un modo por fase (no modifica el modo global)       │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   7. PASO 4 — OUTPUT JSON                    │
│                                                              │
│  {                                                           │
│    "mode": "inline" | "subagent-driven",                     │
│    "confidence": 0.95,                                       │
│    "reasons": ["..."],                                       │
│    "codegraphUsed": ["codegraph_context"],                    │
│    "globalRuleTriggered": "2b",                              │
│    "taskAnalysis": {                                         │
│      "taskCount": 5,                                         │
│      "sharedFiles": {...},                                   │
│      "fileClusters": [["t1","t2"], ["t3","t4"], ["t5"]],     │
│      "clusterCount": 3,                                      │
│      "sequentialDeps": [],                                   │
│      "estLines": 85,                                         │
│      "hasExplicitContract": false                            │
│    },                                                        │
│    "phaseRecommendations": [...]                              │
│  }                                                           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   8. POST-DECISIÓN                           │
│                                                              │
│  Agent definition usa el output:                             │
│                                                              │
│  - mode "inline" → el agente ejecuta todo en su sesión       │
│  - mode "subagent-driven" (Rule 3c) → subagent-driven-dev   │
│  - mode "subagent-driven" (Rule 2b) → cluster dispatch:      │
│    cada cluster se asigna a un subagente                     │
│  - phaseRecommendations: inline PRIMERO, subagent DESPUÉS    │
│                                                              │
│  Orden de fases:                                             │
│    1º Fases inline (establecen contratos)                    │
│    2º Fases subagent-driven (consumen contratos)             │
│    3º Cluster dispatch → subagentes en paralelo              │
└──────────────────────────────────────────────────────────────┘
```

---

## Reglas que gobiernan la decisión

### Modo global (Paso 3a) — basado en clusters

| Regla | Condición | Decisión | Detalle |
|-------|-----------|----------|---------|
| 1 | clusterCount == 1 Y tamaño > 1 | **INLINE** | Todo conectado por archivos compartidos. Imposible paralelizar. |
| 2a | clusterCount >= 2, hay clusters con tamaño > 1, deps ENTRE clusters SIN contrato | **INLINE** | Clusters independientes pero relacionados sin contrato explícito. |
| 2b | clusterCount >= 2, hay clusters con tamaño > 1, SIN deps entre clusters (O contrato existe) | **SUBAGENT-DRIVEN** | Clusters independientes. Cada cluster = 1 subagente. Tasks intra-cluster secuenciales. |
| 3a | Sin archivos compartidos (clusterCount == taskCount), taskCount < 3 | **INLINE** | Muy pocas tasks para amortizar subagentes. |
| 3b | Sin archivos compartidos, estLines < 30 | **INLINE** | Cambio pequeño, inline más eficiente. |
| 3c | Sin archivos compartidos, ninguna condición anterior | **SUBAGENT-DRIVEN** | Tasks independientes. Cada task = 1 subagente. |

### Modo por fase (Paso 3b)

| Regla | Condición | Decisión |
|-------|-----------|----------|
| a | Archivos compartidos dentro de la fase | INLINE |
| b | Comparte archivos con fases inline | INLINE |
| c | Dependencias secuenciales sin contrato | INLINE |
| d | Menos de 4 tasks en la fase | INLINE |
| e | Menos de 30 líneas en la fase | INLINE |
| f | Ninguna condición anterior | SUBAGENT-DRIVEN |

### Excepciones

- **Instrucción del usuario** anula todo el skill — si el usuario dice "hacé todo inline" o "usá subagentes", eso tiene prioridad absoluta.
- **CodeGraph no disponible** — fallback a inline con confianza baja, no bloquear.

---

## Orden de ejecución recomendado

### Si el modo global es "inline" (con phaseRecommendations):
1. **Primero** fases con `mode: "inline"` — establecen interfaces, tipos y módulos
2. **Después** fases con `mode: "subagent-driven"` — consumen lo establecido
3. Si hay dependencias entre fases subagent-driven, respetar el orden de `tasks.md`

### Si el modo global es "subagent-driven" por clusters (Rule 2b):
1. Cada cluster del `fileClusters` se asigna a un subagente
2. Los subagentes se ejecutan en **paralelo** (los clusters no comparten archivos)
3. Tasks dentro del mismo cluster se ejecutan **secuencialmente** dentro del subagente
4. Si hay dependencias ENTRE clusters, deben ejecutarse en orden respetando la dependencia

---

## Limitaciones

- El skill depende de CodeGraph para los datos. Si CodeGraph no está disponible, decide inline por defecto.
- Si `tasks.md` no está organizado en fases, `phaseRecommendations` será un array vacío.
- El clustering asume que dos tasks que modifican el mismo archivo SIEMPRE van a conflictuar si se ejecutan en paralelo. Esto es conservador pero correcto para subagentes independientes.
- La decisión es point-in-time: si se agregan tasks a mitad de cambio, re-ejecutar el skill.
