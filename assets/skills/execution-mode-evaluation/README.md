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
│  5 reglas en orden. La PRIMERA que se cumple decide.        │
│                                                              │
│  1. ¿sharedFiles > 0?                              → INLINE  │
│  2. ¿sequentialDeps sin contrato?                  → INLINE  │
│  3. ¿taskCount < 4?                                → INLINE  │
│  4. ¿estLines < 30?                                → INLINE  │
│  5. Ninguna de las anteriores             → SUBAGENT-DRIVEN  │
│                                                              │
│  Si el usuario dio instrucciones explícitas:                 │
│  → anulan todas las reglas, todas las fases heredan el modo  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│            6. PASO 3b — EVALUACIÓN POR FASES                 │
│            (solo si el modo global es INLINE)                │
│                                                              │
│  Si el modo global es SUBAGENT-DRIVEN → saltar este paso     │
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
│    "globalRuleTriggered": 1,                                 │
│    "taskAnalysis": { ... },                                  │
│    "phaseRecommendations": [                                 │
│      { "phase": "2. Core", "mode": "inline", ... },          │
│      { "phase": "4. Tests", "mode": "subagent-driven", ... } │
│    ]                                                         │
│  }                                                           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   8. POST-DECISIÓN                           │
│                                                              │
│  Agent definition usa el output:                             │
│                                                              │
│  - mode "inline" → el agente ejecuta todo en su sesión       │
│  - mode "subagent-driven" → carga subagent-driven-development│
│  - phaseRecommendations: inline PRIMERO, subagent DESPUÉS    │
│                                                              │
│  Orden de fases:                                             │
│    1º Fases inline (establecen contratos)                    │
│    2º Fases subagent-driven (consumen contratos)             │
└──────────────────────────────────────────────────────────────┘
```

---

## Reglas que gobiernan la decisión

### Modo global (Paso 3a)

| Regla | Condición | Decisión |
|-------|-----------|----------|
| 1 | Archivos compartidos entre tasks | INLINE |
| 2 | Dependencias secuenciales sin contrato explícito | INLINE |
| 3 | Menos de 4 tasks | INLINE |
| 4 | Menos de 30 líneas estimadas | INLINE |
| 5 | Ninguna condición anterior | SUBAGENT-DRIVEN |

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

1. **Primero** fases con `mode: "inline"` — establecen interfaces, tipos y módulos
2. **Después** fases con `mode: "subagent-driven"` — consumen lo establecido
3. Si hay dependencias entre fases subagent-driven, respetar el orden de `tasks.md`

---

## Limitaciones

- El skill depende de CodeGraph para los datos. Si CodeGraph no está disponible, decide inline por defecto.
- Si `tasks.md` no está organizado en fases, `phaseRecommendations` será un array vacío.
- La decisión es point-in-time: si se agregan tasks a mitad de cambio, re-ejecutar el skill.
