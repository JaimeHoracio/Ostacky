/**
 * compaction-threshold.ts — mirror de src/compaction-threshold.ts para plugin (self-contained)
 * Generado desde src/compaction-threshold.ts — NO EDITAR. Ejecutá `bun run scripts/sync-controller-core.ts`.
 */

/**
 * Compactación asistida por umbral fijo (Ostacky).
 *
 * El cálculo (tokens por proveedor, umbral efectivo, decisión) es puro y no toca
 * el proceso: el plugin (assets/plugins/ostacky-controller/index.ts) y `doctor`
 * consumen estas funciones. La única I/O del módulo es la lectura del archivo de
 * configuración del controller (`.opencode/ostacky-controller.json`), que no
 * depende del bloque `environment` del MCP porque ese bloque no llega al plugin.
 * Ver material/plans/analizar-el-agente-ostacky-atomic-boole.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
  /**
   * Desactivada por defecto: la compactación asistida es un mecanismo opt-in.
   * Solo se activa con `compaction.enabled: true` en `ostacky-controller.json`
   * o con `OSTACKY_COMPACT_ENABLED=true` en el entorno.
   */
  enabled: false,
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

/**
 * Configuración desde `process.env` (`OSTACKY_COMPACT_*`). Solo `"true"` activa:
 * cualquier otro valor (incluido `"false"`) deja la compactación desactivada.
 * La precedencia con los archivos la resuelve `resolveCompactConfig`.
 */
export function parseCompactConfig(env: Record<string, string | undefined> = process.env): CompactConfig {
  const enabledRaw = env.OSTACKY_COMPACT_ENABLED;
  const enabled = enabledRaw === undefined ? COMPACT_DEFAULTS.enabled : enabledRaw.trim().toLowerCase() === "true";
  const modeRaw = (env.OSTACKY_COMPACT_MODE ?? COMPACT_DEFAULTS.mode).trim().toLowerCase();
  const mode: CompactMode = modeRaw === "off" || modeRaw === "warn" || modeRaw === "auto" ? (modeRaw as CompactMode) : COMPACT_DEFAULTS.mode;
  const threshold = Math.floor(num(env.OSTACKY_COMPACT_THRESHOLD, DEFAULT_THRESHOLD));
  const model = env.OSTACKY_COMPACT_MODEL?.trim() || undefined;
  return { enabled, mode: enabled ? mode : "off", threshold, model };
}

// ─── Configuración del controller (`.opencode/ostacky-controller.json`) ───────

/** Origen del valor aplicado: lo reporta `doctor` para que se pueda auditar. */
export type CompactConfigOrigin = "env" | "project" | "global" | "default";

export interface CompactConfigResolution {
  cfg: CompactConfig;
  /** Fuente de `enabled`: es la que decide si el mecanismo corre o no. */
  origin: CompactConfigOrigin;
  /** Avisos no fatales (archivo inválido, campo con tipo inesperado). */
  warnings: string[];
}

export interface CompactConfigFiles {
  project?: unknown;
  global?: unknown;
  paths: { project: string; global: string };
  warnings: string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Bloque `compaction` de un archivo, o `null` si no lo define o es inválido. */
function compactionBlock(file: unknown, label: string, warnings: string[]): Record<string, unknown> | null {
  const obj = asObject(file);
  if (!obj) return null;
  if (!("compaction" in obj)) return null;
  const block = asObject(obj.compaction);
  if (!block) {
    warnings.push(`${label}: "compaction" no es un objeto — se ignora`);
    return null;
  }
  return block;
}

function pickEnabled(sources: Array<{ label: string; block: Record<string, unknown> | null }>, warnings: string[]): { value: boolean | null; origin: CompactConfigOrigin } {
  for (const { label, block } of sources) {
    if (!block || !("enabled" in block)) continue;
    if (typeof block.enabled === "boolean") return { value: block.enabled, origin: label as CompactConfigOrigin };
    warnings.push(`${label}: "compaction.enabled" debe ser boolean — se ignora`);
  }
  return { value: null, origin: "default" };
}

function pickString(sources: Array<{ label: string; block: Record<string, unknown> | null }>, key: string, warnings: string[]): string | null {
  for (const { label, block } of sources) {
    if (!block || !(key in block)) continue;
    const raw = block[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    warnings.push(`${label}: "compaction.${key}" debe ser string no vacío — se ignora`);
  }
  return null;
}

function pickNumber(sources: Array<{ label: string; block: Record<string, unknown> | null }>, key: string, warnings: string[]): number | null {
  for (const { label, block } of sources) {
    if (!block || !(key in block)) continue;
    const raw = block[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    warnings.push(`${label}: "compaction.${key}" debe ser número > 0 — se ignora`);
  }
  return null;
}

/**
 * Resuelve la configuración por prioridad: `process.env` > archivo del proyecto >
 * archivo global > defaults. Campo por campo, así un archivo puede fijar solo el
 * umbral. Archivo ausente, ilegible o inválido NO activa nada: cae al default
 * (desactivado) y deja un aviso.
 */
export function resolveCompactConfig(input: {
  env?: Record<string, string | undefined>;
  project?: unknown;
  global?: unknown;
} = {}): CompactConfigResolution {
  const env = input.env ?? {};
  const warnings: string[] = [];
  const projectBlock = compactionBlock(input.project, "proyecto", warnings);
  const globalBlock = compactionBlock(input.global, "global", warnings);
  const fileSources = [
    { label: "project", block: projectBlock },
    { label: "global", block: globalBlock },
  ];

  const envEnabled = env.OSTACKY_COMPACT_ENABLED;
  let enabled: boolean;
  let origin: CompactConfigOrigin;
  if (envEnabled !== undefined) {
    enabled = envEnabled.trim().toLowerCase() === "true";
    origin = "env";
  } else {
    const picked = pickEnabled(fileSources, warnings);
    enabled = picked.value ?? COMPACT_DEFAULTS.enabled;
    origin = picked.value === null ? "default" : picked.origin;
  }

  const envMode = env.OSTACKY_COMPACT_MODE?.trim().toLowerCase();
  const fileMode = envMode === undefined ? pickString(fileSources, "mode", warnings) : null;
  const modeRaw = envMode ?? fileMode ?? COMPACT_DEFAULTS.mode;
  const mode: CompactMode = modeRaw === "off" || modeRaw === "warn" || modeRaw === "auto" ? (modeRaw as CompactMode) : COMPACT_DEFAULTS.mode;
  if (envMode !== undefined && mode !== envMode) warnings.push(`env: OSTACKY_COMPACT_MODE="${envMode}" inválido — se usa ${COMPACT_DEFAULTS.mode}`);

  const threshold = env.OSTACKY_COMPACT_THRESHOLD !== undefined
    ? Math.floor(num(env.OSTACKY_COMPACT_THRESHOLD, DEFAULT_THRESHOLD))
    : pickNumber(fileSources, "threshold", warnings) ?? DEFAULT_THRESHOLD;

  const model = env.OSTACKY_COMPACT_MODEL?.trim() || pickString(fileSources, "model", warnings) || undefined;

  return {
    cfg: { enabled, mode: enabled ? mode : "off", threshold, model },
    origin,
    warnings,
  };
}

/** Ruta del archivo de configuración del controller en el proyecto. */
export function projectCompactConfigPath(directory: string): string {
  return join(directory, ".opencode", "ostacky-controller.json");
}

/** Ruta del archivo global: mismo criterio que el resto de Ostacky para el config dir. */
export function globalCompactConfigPath(env: Record<string, string | undefined> = process.env, home?: string): string {
  const explicit = env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) return join(explicit, "ostacky-controller.json");
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(home ?? homedir(), ".config", "opencode");
  return join(base, "ostacky-controller.json");
}

function readConfigFile(path: string, label: string, warnings: string[]): unknown {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
  } catch (err: any) {
    warnings.push(`${label}: no se pudo parsear ${path} (${err?.message ?? "error"}) — se usan defaults`);
    return undefined;
  }
}

/**
 * Lee los dos archivos de configuración del controller. Ausente o inválido no es
 * error: devuelve `undefined` en ese slot y un aviso. No lanza.
 */
export function readCompactConfigFiles(directory: string, opts: {
  env?: Record<string, string | undefined>;
  home?: string;
} = {}): CompactConfigFiles {
  const env = opts.env ?? process.env;
  const paths = {
    project: projectCompactConfigPath(directory),
    global: globalCompactConfigPath(env, opts.home),
  };
  const warnings: string[] = [];
  const project = readConfigFile(paths.project, "proyecto", warnings);
  const global = readConfigFile(paths.global, "global", warnings);
  return { project, global, paths, warnings };
}

/** Lectura + resolución en un paso. Es lo que usan el plugin y `doctor`. */
export function loadCompactConfig(directory: string, opts: {
  env?: Record<string, string | undefined>;
  home?: string;
} = {}): CompactConfigResolution & { paths: { project: string; global: string } } {
  const files = readCompactConfigFiles(directory, opts);
  const resolved = resolveCompactConfig({ env: opts.env ?? process.env, project: files.project, global: files.global });
  return { ...resolved, warnings: [...files.warnings, ...resolved.warnings], paths: files.paths };
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
