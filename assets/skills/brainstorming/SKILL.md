---
name: brainstorming
description: "Thinking partner for exploring ideas, investigating problems, and designing solutions. Two modes: creative-design (structured, produces design doc) and open-explore (unstructured, no mandatory output). Use when the user wants to think through something, brainstorm, explore an idea, or design a solution before or during a change."
---

# Brainstorming

A thinking partner that adapts to what the user needs: structured design when they're building something, open exploration when they're investigating or clarifying.

**Follow Core Instructions** — `ostacky.md` Core Instructions section for CodeGraph and Engram usage patterns.

---

## Mode Detection

| Signal | Mode |
|--------|------|
| "design", "build", "create", "add feature", "implement" | **creative-design** |
| "explore", "investigate", "think through", "what if", "how does" | **open-explore** |
| "brainstorm", "ideate", "propose approach" | **creative-design** |
| "check", "understand", "review existing" | **open-explore** |
| Unclear | Ask in natural language: "¿Querés diseñar algo nuevo o explorar/entender algo existente?" |

---

## Mode 1: creative-design

Turn ideas into fully formed designs through collaborative dialogue.

### HARD-GATE

Do NOT invoke any implementation skill, write any code, or scaffold any project until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.

### Process

1. **Check Engram** — `mem_search` with keywords from the user's idea. Surface any prior design decisions or similar proposals.
2. **Explore via CodeGraph** — `codegraph_explore` on the affected area. Only `Read` files CodeGraph didn't cover.
3. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to complexity, get user approval after each section
6. **Write design doc** — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit
7. **Spec self-review** — check for placeholders, contradictions, ambiguity, scope
8. **User reviews spec** — ask user to review before proceeding
9. **Save to Engram** — `mem_save` with the design decision and tradeoffs
10. **Transition** — based on routing decision (see Transition Rules below)

### Transition Rules

The next step depends on how the change was routed by Ostacky:

| Routing | Next Skill | When |
|---------|------------|------|
| **DIRECT** (Level 0/0+1) | `writing-plans` | Small changes, no OpenSpec |
| **SPEC** (Level 1+) | `openspec-propose` | Complex changes requiring OpenSpec artifacts |

If you're unsure about routing, ask Ostacky or check the controller state.

**Terminal state:** Invoke the appropriate next skill. Do NOT invoke implementation skills directly.

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
