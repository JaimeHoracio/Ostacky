/**
 * compaction-assist.ts — mirror de src/compaction-assist.ts para plugin (self-contained)
 * Generado desde src/compaction-assist.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Compactación asistida — máquina de estados pura (sin I/O, sin hooks).
 *
 * El plugin (assets/plugins/ostacky-controller/index.ts) solo traduce eventos V2 a
 * estas transiciones y llama a la API nativa cuando corresponde. Así las reglas
 * (una sola pregunta, no acumular mediciones, stale tras compactar, un reintento)
 * se testean sin levantar el server.
 *
 * Fases:
 *   idle        — sin decisión pendiente; se evalúa el umbral en cada medición.
 *   pending     — hay una pregunta planteada y sin responder: el gate bloquea.
 *   compacting  — se pidió `ctx.session.compact` y se espera el evento de fin.
 *   stale       — la medición quedó invalidada (tras compactar) hasta el próximo paso.
 */

export type AssistPhase = "idle" | "pending" | "compacting" | "stale";

export interface AssistState {
  phase: AssistPhase;
  /** Última medición válida (reemplaza la anterior: nunca se suma). */
  tokens: number | null;
  /** Medición anterior, para detectar el cruce del umbral desde abajo. */
  prevTokens: number | null;
  /** true tras compactar: el valor queda congelado hasta el próximo `session.step.ended`. */
  stale: boolean;
  /** Ya se preguntó por la medición vigente. */
  asked: boolean;
  /** Reintentos de compactación usados en este ciclo (máximo `ASSIST_MAX_RETRIES`). */
  retries: number;
  lastCompactTs: number | null;
  lastError: string | null;
}

/** Un solo reintento automático ante fallo de compactación. */
export const ASSIST_MAX_RETRIES = 1;

export function assistInit(): AssistState {
  return {
    phase: "idle",
    tokens: null,
    prevTokens: null,
    stale: false,
    asked: false,
    retries: 0,
    lastCompactTs: null,
    lastError: null,
  };
}

/**
 * Registra una medición nueva. Reemplaza el valor (no acumula): `tokens` es el uso
 * del último paso, no un contador. Con una compactación en curso o una pregunta
 * pendiente conserva la fase para no perder el bloqueo.
 */
export function recordMeasurement(state: AssistState, input: { tokens: number; now?: number }): AssistState {
  const tokens = Math.max(0, Math.floor(Number(input.tokens) || 0));
  const phase: AssistPhase = state.phase === "compacting" || state.phase === "pending" ? state.phase : "idle";
  return {
    ...state,
    phase,
    prevTokens: state.tokens,
    tokens,
    stale: false,
    // Bajar del umbral abre un ciclo nuevo: el próximo cruce vuelve a preguntar.
    asked: state.tokens === null || tokens >= state.tokens ? state.asked : false,
  };
}

/** ¿El valor cruzó el umbral desde abajo? (primera medición cuenta como cruce) */
export function crossesThreshold(prev: number | null, next: number, threshold: number): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  if (next < threshold) return false;
  return prev === null || prev < threshold;
}

export interface ShouldAskOptions {
  threshold: number;
  enabled?: boolean;
  /** Opt-out explícito del usuario para esta sesión. */
  optOut?: boolean;
  cooldownMs?: number;
  now?: number;
  /** Punto seguro (fin de turno). En mitad de una tarea no se pregunta. */
  safePoint?: boolean;
}

/**
 * Decide si corresponde plantear la pregunta. Una sola vez por cruce: tras
 * Continuar el valor sigue por encima del umbral y NO se vuelve a preguntar hasta
 * que una nueva medición cruce desde abajo (p. ej. después de compactar).
 */
export function shouldAsk(state: AssistState, opts: ShouldAskOptions): boolean {
  if (opts.enabled === false) return false;
  if (opts.optOut) return false;
  if (opts.safePoint === false) return false;
  if (state.phase === "pending" || state.phase === "compacting") return false;
  if (state.stale) return false;
  if (state.tokens === null) return false;
  if (!crossesThreshold(state.prevTokens, state.tokens, opts.threshold)) return false;
  const now = opts.now ?? Date.now();
  const cooldown = opts.cooldownMs ?? 0;
  if (state.lastCompactTs !== null && cooldown > 0 && now - state.lastCompactTs < cooldown) return false;
  return true;
}

/** La pregunta quedó planteada: bloquea hasta que el usuario responda. */
export function markAsked(state: AssistState): AssistState {
  return { ...state, phase: "pending", asked: true };
}

/**
 * El usuario eligió Continuar (o hay opt-out): se libera el bloqueo y no se
 * vuelve a preguntar hasta el próximo cruce.
 */
export function continueSession(state: AssistState): AssistState {
  return { ...state, phase: "idle", asked: true, lastError: null };
}

/** El usuario eligió Compactar: queda en curso hasta el evento de fin. */
export function requestCompaction(state: AssistState, now: number = Date.now()): AssistState {
  return { ...state, phase: "compacting", lastCompactTs: now, lastError: null };
}

/** Una compactación arrancó por fuera del asistente (p. ej. pedida por el usuario). */
export function compactionStarted(state: AssistState, now: number = Date.now()): AssistState {
  if (state.phase === "compacting") return state;
  return { ...state, phase: "compacting", lastCompactTs: now };
}

/**
 * Compactación terminada: la medición previa ya no describe el contexto. Se
 * conserva el último valor con `stale: true` — nunca se registra `tokens: 0`.
 */
export function compactionEnded(state: AssistState): AssistState {
  return { ...state, phase: "stale", stale: true, asked: false, retries: 0, lastError: null };
}

/** Compactación fallida: se libera el gate, se cuenta el reintento y no se repite solo. */
export function compactionFailed(state: AssistState, error: unknown, now: number = Date.now()): AssistState {
  const message = typeof error === "string" ? error : (error as any)?.message ?? "compactación fallida";
  return {
    ...state,
    phase: "idle",
    asked: true,
    retries: state.retries + 1,
    lastCompactTs: now,
    lastError: String(message).slice(0, 200),
  };
}

/**
 * Queda algún reintento automático disponible para este ciclo. `retries` cuenta
 * fallos: tras el primero se permite un único reintento; después no.
 */
export function canRetryCompaction(state: AssistState): boolean {
  return state.retries <= ASSIST_MAX_RETRIES;
}

/** Mientras hay una pregunta sin responder, el gate bloquea escrituras y ejecución. */
export function assistBlocksTools(state: AssistState): boolean {
  return state.phase === "pending";
}

/**
 * Punto seguro para plantear la pregunta (D5 / spec "Tarea compleja en curso").
 * Mientras el controller ejecuta tareas (EXECUTING_*) el turno no es seguro: la pregunta
 * se difiere al siguiente `session.idle`, que llega al terminar el turno o la fase.
 */
export function isSafePointState(controllerState: string | null): boolean {
  return controllerState !== "EXECUTING_INLINE" && controllerState !== "EXECUTING_SUBAGENTS";
}
