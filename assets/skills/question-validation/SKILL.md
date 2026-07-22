---
name: question-validation
description: Validates that the agent uses OpenCode's native question tool instead of the removed ask-user MCP. Triggers on any question-asking scenario.
---

# Question Validation

## Purpose

Prevents the agent from attempting to use the removed `ask_user` MCP server. The MCP always times out because it cannot access the TTY in OpenCode's process model.

## Rules

### BEFORE asking any question

1. **NEVER use `ask_user` MCP** — it does not exist anymore and will timeout
2. **ALWAYS use the native `question` tool** — it works correctly

### Correct format

```json
{
  "questions": [
    {
      "question": "The question to ask",
      "header": "Short label (max 30 chars)",
      "options": [
        { "label": "Option A", "description": "What this means" },
        { "label": "Option B", "description": "What this means" }
      ]
    }
  ]
}
```

### Validation checklist

- [ ] Did I use `question` tool? (not `ask_user`)
- [ ] Is the `question` field present?
- [ ] Are `options` provided with both `label` and `description`?
- [ ] Is the `header` short (max 30 chars)?

### Error recovery

If you accidentally called `ask_user`:
1. STOP immediately
2. Use `question` tool instead
3. Do not retry the MCP call

## Examples

### Good

```json
{
  "questions": [
    {
      "question": "¿Qué enfoque preferís?",
      "header": "Enfoque",
      "options": [
        { "label": "Directo", "description": "Implementar sin spec" },
        { "label": "Con spec", "description": "Generar spec primero" }
      ]
    }
  ]
}
```

### Bad

```json
// WRONG — this is the removed MCP
{
  "question": "¿Qué preferís?",
  "options": ["A", "B"]
}
```
