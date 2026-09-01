/**
 * @deprecated Fusionado en ostacky-plugin.ts — re-export legacy.
 * Single source: importa desde src/security.ts vía controller.
 * Fresh install solo escribe ostacky-plugin.ts + engram.ts.
 * Este archivo no debe ser instalado por ostacky install (deprecado).
 */

import type { Plugin } from "@opencode-ai/plugin"

// Re-export controller como guard por compatibilidad — no duplica isSensitive/BASH_SENSITIVE_RE
export { OstackyController as OstackyGuard } from "./ostacky-plugin.ts"

// También export default por compatibilidad con loaders que esperan default
import { OstackyController } from "./ostacky-plugin.ts"
export default OstackyController

// Nota: isSensitive, BASH_SENSITIVE_RE, extractPathsFromBash vienen de src/security.ts
// a través de ostacky-plugin.ts, no se copian aquí (verificación check:security).
