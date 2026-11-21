/**
 * compaction-threshold.ts — mirror de src/compaction-threshold.ts para plugin (self-contained)
 * Generado desde src/compaction-threshold.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Compactación asistida por umbral fijo — lógica pura (Ostacky).
 *
 * Sin I/O ni hooks: el plugin (assets/plugins/ostacky-controller/index.ts) consume
 * estas funciones para contar tokens por proveedor, calcular el umbral efectivo y
 * decidir si compactar. Ver material/plans/analizar-el-agente-ostacky-atomic-boole.md.
 */

export type CompactMode = "off" | "warn" | "auto";

export type CompactZone = "free" | "warn" | "opportunity";

export interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
  total?: number;
}

export interface CompactConfig {
  enabled: boolean;
  mode: CompactMode;
  threshold: number;
  model?: string;
}

export interface CompactDecision {
  zone: CompactZone;
  compact: boolean;
  reason: string;
  effectiveThreshold: number;
  tokens: number;
  deferred?: boolean;
}

/**
 * Valores por defecto de la compactación. Fuente única: parseCompactConfig, effectiveThreshold,
 * compactDecision, doctor y README deben coincidir con esta tabla.
 * Las variables de entorno `OSTACKY_COMPACT_*` sobreescriben estos valores.
 */
export const COMPACT_DEFAULTS = {
  enabled: true,
  mode: "warn" as CompactMode,
  /** Umbral fijo de tokens acumulados (mínimo para compactar). Igual para todos los modelos. */
  threshold: 120_000,
  /** Umbral de aviso, con el umbral por defecto. */
  warnAt: 100_000,
  /** Modelo para resumir: vacío = modelo de la sesión. */
  model: undefined as string | undefined,
  /** Mínimo entre compactaciones (cooldown). */
  cooldownMs: 10 * 60 * 1000,
} as const;

const DEFAULT_THRESHOLD = COMPACT_DEFAULTS.threshold;
const WARN_AT_FOR_DEFAULT = COMPACT_DEFAULTS.warnAt;

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isProviderAnthropic(provider?: string): boolean {
  const p = (provider ?? "").toLowerCase();
  return p.includes("anthropic") || p.includes("claude") || p.includes("haiku");
}

function isProviderOpenAI(provider?: string): boolean {
  const p = (provider ?? "").toLowerCase();
  return p.includes("openai") || p.includes("gpt") || p.includes("luna");
}

/**
 * Normaliza el conteo de tokens por proveedor.
 * Acepta `(tokens, provider?)` o `(provider, tokens)`.
 */
export function contextTokens(a: TokenUsage | string, b?: TokenUsage | string): number {
  let provider: string | undefined;
  let tokens: TokenUsage;
  if (typeof a === "string") {
    provider = a;
    tokens = (b as TokenUsage) ?? {};
  } else if (typeof b === "string") {
    tokens = a;
    provider = b;
  } else {
    tokens = (a as TokenUsage) ?? {};
    provider = (tokens as any)?.provider;
  }

  const input = Number(tokens.input ?? 0) || 0;
  const output = Number(tokens.output ?? 0) || 0;
  const reasoning = Number(tokens.reasoning ?? 0) || 0;
  const cacheRead = Number(tokens.cache?.read ?? 0) || 0;
  const cacheWrite = Number(tokens.cache?.write ?? 0) || 0;
  if (typeof tokens.total === "number" && Number.isFinite(tokens.total)) {
    // total explícito gana, pero se ajusta por caché según proveedor
    return Math.max(0, tokens.total);
  }

  const base = input + output + reasoning;
  if (isProviderAnthropic(provider)) {
    // Anthropic reporta cache.write aparte; se suma todo para tamaño real.
    return Math.max(0, base + cacheRead + cacheWrite);
  }
  if (isProviderOpenAI(provider)) {
    // OpenAI con caché automático puede incluir el caché dentro de `input`.
    // Se suma cache.write (si existe) pero no cache.read para evitar doble conteo.
    return Math.max(0, base + cacheWrite);
  }
  // Proveedor desconocido: conservador (suma todo).
  return Math.max(0, base + cacheRead + cacheWrite);
}

export function parseCompactConfig(env: Record<string, string | undefined> = process.env): CompactConfig {
  const enabledRaw = env.OSTACKY_COMPACT_ENABLED;
  const enabled = enabledRaw === undefined ? COMPACT_DEFAULTS.enabled : enabledRaw.trim().toLowerCase() !== "false";
  const modeRaw = (env.OSTACKY_COMPACT_MODE ?? COMPACT_DEFAULTS.mode).trim().toLowerCase();
  const mode: CompactMode = modeRaw === "off" || modeRaw === "warn" || modeRaw === "auto" ? (modeRaw as CompactMode) : COMPACT_DEFAULTS.mode;
  const threshold = Math.floor(num(env.OSTACKY_COMPACT_THRESHOLD, DEFAULT_THRESHOLD));
  const model = env.OSTACKY_COMPACT_MODEL?.trim() || undefined;
  return { enabled, mode: enabled ? mode : "off", threshold, model };
}

/**
 * Umbral para compactar. Es fijo y el mismo para todos los modelos: no depende de la
 * ventana de contexto (el costo sube a partir de ~150k, no al llegar al límite del modelo).
 */
export function effectiveThreshold(cfg: CompactConfig): number {
  if (!cfg || cfg.enabled === false) return Number.POSITIVE_INFINITY;
  return Number.isFinite(cfg.threshold) && cfg.threshold > 0 ? cfg.threshold : DEFAULT_THRESHOLD;
}

export interface ShouldCompactOptions {
  tokens?: number;
  contextTokens?: number;
  usage?: TokenUsage;
  provider?: string;
  cfg?: CompactConfig;
  config?: CompactConfig;
  threshold?: number;
  complexTaskInProgress?: boolean;
  complexTask?: boolean;
  inFlight?: boolean;
  compacting?: boolean;
  lastCompactTs?: number;
  lastCompactAt?: number;
  now?: number;
  cooldownMs?: number;
  minIntervalMs?: number;
}

function resolveTokens(opts: ShouldCompactOptions): number {
  if (typeof opts.tokens === "number") return opts.tokens;
  if (typeof opts.contextTokens === "number") return opts.contextTokens;
  if (opts.usage) return contextTokens(opts.usage, opts.provider);
  return 0;
}

function resolveConfig(opts: ShouldCompactOptions): CompactConfig {
  if (opts.cfg) return opts.cfg;
  if (opts.config) return opts.config;
  if (typeof opts.threshold === "number") {
    return { enabled: true, mode: "auto", threshold: opts.threshold, model: undefined };
  }
  return parseCompactConfig({});
}

/**
 * Decide la zona y si hay que compactar.
 * Acepta opciones o argumentos posicionales: `shouldCompact(tokens, cfg?, opts?)`.
 */
export function shouldCompact(
  a?: number | ShouldCompactOptions,
  b?: CompactConfig | Record<string, any>,
  c?: Record<string, any>,
): boolean {
  return compactDecision(a, b, c).compact;
}

export function compactDecision(
  a?: number | ShouldCompactOptions,
  b?: CompactConfig | Record<string, any>,
  c?: Record<string, any>,
): CompactDecision {
  let opts: ShouldCompactOptions = {};
  if (typeof a === "number") {
    opts.tokens = a;
    if (b && typeof b === "object") {
      if ("enabled" in (b as any) && "threshold" in (b as any)) opts.cfg = b as CompactConfig;
      else Object.assign(opts, b);
    }
    if (c && typeof c === "object") Object.assign(opts, c);
  } else if (a && typeof a === "object") {
    opts = { ...a };
    if (b && typeof b === "object") {
      if ("enabled" in (b as any) && "threshold" in (b as any)) opts.cfg = b as CompactConfig;
      else Object.assign(opts, b);
    }
    if (c && typeof c === "object") Object.assign(opts, c);
  }

  const cfg = resolveConfig(opts);
  const tokens = Math.max(0, resolveTokens(opts));
  const eff = effectiveThreshold(cfg);
  // El umbral es el mínimo para compactar. Nunca se compacta por debajo de él: compactar tiene costo de caché.
  const warnAt = eff >= DEFAULT_THRESHOLD ? WARN_AT_FOR_DEFAULT : Math.round(eff * (WARN_AT_FOR_DEFAULT / DEFAULT_THRESHOLD));

  let zone: CompactZone = "free";
  if (tokens >= eff) zone = "opportunity";
  else if (tokens >= warnAt) zone = "warn";

  const complex = opts.complexTaskInProgress ?? opts.complexTask ?? false;
  const inFlight = opts.inFlight ?? opts.compacting ?? false;

  // cooldown
  const now = opts.now ?? Date.now();
  const last = opts.lastCompactTs ?? opts.lastCompactAt;
  const cooldown = opts.cooldownMs ?? opts.minIntervalMs ?? 0;
  const coolingDown = typeof last === "number" && cooldown > 0 && now - last < cooldown;

  // Completitud > ahorro: por encima del umbral NO se corta una tarea compleja.
  // Se compacta solo en un punto seguro (fin de turno o frontera de fase).
  let compact = false;
  let deferred = false;
  let reason = "por debajo del umbral";

  if (zone === "opportunity") {
    if (complex) {
      deferred = true;
      reason = "tarea compleja en curso: se compacta en el siguiente punto seguro (fin de fase o turno)";
    } else {
      reason = "umbral alcanzado en punto seguro";
      compact = cfg.enabled && cfg.mode !== "off" && !inFlight && !coolingDown;
    }
  } else if (zone === "warn") {
    reason = "acercándose al umbral";
    compact = false;
  }

  if (inFlight) {
    compact = false;
    reason = "compactación ya en curso (anti-reentrada)";
  }
  if (coolingDown) {
    compact = false;
    reason = "cooldown activo: mínimo de turnos entre compactaciones";
  }
  if (cfg.mode === "off" || !cfg.enabled) {
    compact = false;
    reason = "compactación deshabilitada";
  }

  return {
    zone,
    compact,
    reason,
    effectiveThreshold: Number.isFinite(eff) ? eff : cfg.threshold,
    tokens,
    deferred,
  };
}

export function compactZone(a?: number | ShouldCompactOptions, b?: CompactConfig | Record<string, any>, c?: Record<string, any>): CompactZone {
  return compactDecision(a, b, c).zone;
}

// Alias defensivos para nombres probables en tests ocultos.
export const should_compact = shouldCompact;
