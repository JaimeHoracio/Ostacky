---
name: brainstorming
description: "Thinking partner for exploring ideas, investigating problems, and designing solutions. Two modes: creative-design (structured, produces design doc) and open-explore (unstructured, no mandatory output). Use when the user wants to think through something, brainstorm, explore an idea, or design a solution before or during a change."
---

# Brainstorming

A thinking partner that adapts to what the user needs: structured design when they're building something, open exploration when they're investigating or clarifying.

**Follow Core Instructions** — `ostacky.md` Core Instructions section for CodeGraph and Engram usage patterns.

**IMPORTANT:** Engram is an **MCP server**, not a skill. Tools `engram_mem_save`, `engram_mem_search`, `engram_mem_context` are MCP tools. Do NOT use `skill("engram")` — it doesn't exist.

---

## Mode Detection

| Signal | Mode |
|--------|------|
| "design", "build", "create", "add feature", "implement" | **creative-design** |
| "explore", "investigate", "think through", "what if", "how does" | **open-explore** |
| "brainstorm", "ideate", "propose approach" | **creative-design** |
| "mejor forma", "qué conviene", "tradeoff", "comparar", "diseñar", "arquitectura", "alternativas", "evaluar opciones" | **creative-design** — **hardening-v2**: SHALL invocar skill con CodeGraph+Engram, 2-3 approaches con tabla trade-offs y recomendación |
| "check", "understand", "review existing" | **open-explore** |
| Unclear | Ask in natural language: "¿Querés diseñar algo nuevo o explorar/entender algo existente?" |

---

## Mode 1: creative-design

Turn ideas into fully formed designs through collaborative dialogue.

### HARD-GATE

Do NOT invoke any implementation skill, write any code, or scaffold any project until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.

### Process

1. **Check discovery-cache first** — `src/discovery-cache.ts` `getDiscoverySnapshot(query)` + `getEngramDedup(query, requestId)`. Si hit válido (TTL+gitDiffHash), **reusar** sin llamar tools. Solo si miss → `engram_mem_search` + `codegraph_codegraph_explore` y **SHALL `putDiscoverySnapshot`** antes de avanzar. No re-llamar si área difiere <30% del snapshot.
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches (hardening-v2 — SHALL)** — con tabla trade-offs (coste|riesgo|complejidad) + evidencia CodeGraph+Engram sin alucinar, YAGNI, y recomendación con razón; cada approach cita symbols existentes y mem_search hits verificables
5. **Present design** — in sections scaled to complexity, get user approval after each section. **Gate post-brainstorming (hardening-v2):** tras presentar diseño, preguntar "¿Procedo con este diseño o querés ajustar algo?" y esperar confirmación explícita antes de `record_discovery`, `openspec-propose` o implementación directa
6. **Write design doc (output path condicional — router exclusivo):**
   - Si trigger + `level 1+` no-downgradeable (`estLines>30` o `fileCount>2` o API pública) y change activo → escribir `openspec/changes/<id>/design.md` sección `## Alternatives Considered` con 2-3 approaches (tabla coste|riesgo|complejidad + evidencia CodeGraph+Engram), no `docs/`. No invocar `openspec-propose` separado — este es el diseño.
   - Si trigger + `0/0+1` o `1+` downgradeable (`estLines<30`&&`fileCount==1`&&sin API) → solo `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` + gate único `¿Procedo?` → DIRECT sin change. SHALL sugerir downgrade: `"Esto parece 0+1 (~X líneas, 1 archivo). ¿Lo tratamos sin spec?"` y esperar.
   - Gate post-brainstorming es **único**; no hay segundo `¿Procedo con spec?`. `get_audit` `WARN:duplicate_design_generated` si ambos artefactos mismo `requestId`.
7. **Spec self-review** — check for placeholders, contradictions, ambiguity, scope
8. **User reviews spec** — ask user to review before proceeding
9. **Save to Engram** — `engram_mem_save` with the design decision and tradeoffs
10. **Transition** — based on routing decision (see Transition Rules below)

### Transition Rules (router exclusivo — reemplaza SHALL secuencial)

| Trigger + Nivel | Output path | Next Step | Gate |
|---|---|---|---|
| `mejor forma\|tradeoff\|...` + `1+` no-downgradeable | `openspec/changes/<id>/design.md` `## Alternatives` | Fin brainstorming → `spec_complete` vía change | Único `¿Procedo?` |
| `mejor forma\|tradeoff\|...` + `0/0+1` o `1+` downgradeable | `docs/superpowers/specs/...` solo | DIRECT | Único `¿Procedo?` + sugerencia downgrade explícita |
| Sin trigger + claros | — | `openspec-propose` directo (no brainstorming) | — |
| Sin trigger + vagos | — | Pregunta `¿brainstorming o spec?` | — |

`WARN:skipped_brainstorming` solo si trigger presente y se omite sin downgrade. `WARN:duplicate_design_generated` si ambos paths mismo `requestId`.

### Design Principles

- **One question at a time** — Don't overwhelm
- **Multiple choice preferred** — Easier to answer
- **YAGNI ruthlessly** — Remove unnecessary features
- **Explore alternatives** — Always propose 2-3 approaches
- **Incremental validation** — Present design, get approval before moving on
- **Design for isolation** — Break into smaller units with clear purposes

### Working in Existing Codebases

- Explore current structure before proposing changes. Follow existing patterns.
- Include targeted improvements where existing code affects the work.
- Don't propose unrelated refactoring. Stay focused on the goal.

### Spec Self-Review

After writing the spec:
1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections? Fix them.
2. **Internal consistency:** Do sections contradict each other?
3. **Scope check:** Focused enough for a single implementation plan?
4. **Ambiguity check:** Any requirement interpretable two ways? Pick one.

### User Review Gate

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for response. If changes requested, make them and re-review. Only proceed once approved.

---

## Mode 2: open-explore

A stance, not a workflow. Think deeply. Visualize freely. Follow the conversation wherever it goes.

### What You Might Do

**Explore the problem space**
- Ask clarifying questions that emerge from what they said
- Challenge assumptions
- Reframe the problem
- Find analogies

**Investigate the codebase**
- Map existing architecture relevant to the discussion
- Find integration points
- Identify patterns already in use
- Surface hidden complexity

**Compare options**
- Brainstorm multiple approaches
- Build comparison tables
- Sketch tradeoffs
- Recommend a path (if asked)

**Visualize**
```
Use ASCII diagrams liberally:
System diagrams, state machines, data flows,
architecture sketches, dependency graphs,
comparison tables
```

**Surface risks and unknowns**
- Identify what could go wrong
- Find gaps in understanding
- Suggest spikes or investigations

### OpenSpec Awareness

Check for active changes at start:
```bash
openspec list --json
```

If a change exists and the user mentions it:
1. Read existing artifacts (`proposal.md`, `design.md`, `tasks.md`)
2. Reference them naturally in conversation
3. Offer to capture when decisions are made — don't auto-capture

| Insight Type | Where to Capture |
|---|---|
| New requirement | `specs/<capability>/spec.md` |
| Design decision | `design.md` |
| Scope change | `proposal.md` |
| New work | `tasks.md` |

### What You Don't Have To Do

- Follow a script
- Produce a specific artifact
- Reach a conclusion
- Stay on topic if a tangent is valuable
- Be brief (this is thinking time)

### Ending Discovery

No required ending. Discovery might:
- **Flow into a proposal:** "Ready to start? I can create a change proposal." → invoke `openspec-propose`
- **Result in artifact updates:** "Updated design.md with these decisions"
- **Just provide clarity:** User has what they need, moves on
- **Continue later:** "We can pick this up anytime"

When things crystallize, summarize:
```
## What We Figured Out
**The problem**: [understanding]
**The approach**: [if one emerged]
**Open questions**: [if any]
**Next steps** (if ready):
- Create a change proposal (invoke openspec-propose)
- Keep exploring
```

But the summary is optional. Sometimes the thinking IS the value.

### Guardrails

- **Don't implement** — Never write code. Creating OpenSpec artifacts is fine.
- **Don't fake understanding** — Dig deeper if unclear
- **Don't rush** — Discovery is thinking time, not task time
- **Don't force structure** — Let patterns emerge naturally
- **Don't auto-capture** — Offer to save insights, don't just do it
- **Do visualize** — A good diagram is worth many paragraphs
- **Do explore the codebase** — Ground discussions in reality
- **Do question assumptions** — Including your own

---

## Visual Companion

Browser use is text-only by default.

- Only use the browser when the user explicitly asks for browser/visual help.
- Do not suggest the browser just because it might explain something more clearly.
- If the user asks for browser/visual help, use illustrations and diagrams in the conversation to explain concepts.
