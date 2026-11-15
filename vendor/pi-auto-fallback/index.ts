import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ChainConfig = {
  name: string;
  models: string[];
};

export type Config = {
  enabled: boolean;
  chains: ChainConfig[];
  maxFailoversPerRequest: number;
  requireNoToolCalls: boolean;
  retryableStatusCodes: number[];
  retryablePatterns: string[];
  nonRetryablePatterns: string[];
  retryInstruction: string;
  notify: boolean;
};

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
export const CONFIG_PATH = join(AGENT_DIR, "auto-fallback.json");

const DEFAULT_CONFIG: Config = {
  // Missing or invalid configuration must not silently activate an
  // author-specific model chain.
  enabled: false,
  chains: [],
  maxFailoversPerRequest: 2,
  requireNoToolCalls: true,
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529],
  retryablePatterns: [
    "timeout",
    "timed out",
    "origin_response_timeout",
    "error 524",
    "http 524",
    "rate limit",
    "too many requests",
    "overloaded",
    "unavailable",
    "resource_exhausted",
    "econnreset",
    "econnrefused",
    "etimedout",
    "socket hang up",
    "fetch failed",
    "connection reset",
    "connection refused"
  ],
  nonRetryablePatterns: [
    "invalid api key",
    "authentication",
    "unauthorized",
    "forbidden",
    "invalid model",
    "model not found",
    "context_length_exceeded",
    "context window",
    "maximum context length"
  ],
  retryInstruction: "The previous model request failed because of a transient provider/network error. Retry the immediately preceding user request exactly, without changing its intent. Do not mention this fallback unless it materially affects the answer.",
  notify: true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function optionalString(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalStringArray(raw: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const value = raw[key];
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

export function normalizeConfig(raw: unknown): Config {
  if (!isRecord(raw)) throw new Error("config must be a JSON object");

  const enabled = optionalBoolean(raw, "enabled", DEFAULT_CONFIG.enabled);
  const rawChains = raw.chains;
  let chains: ChainConfig[] = [];
  if (rawChains !== undefined) {
    if (!Array.isArray(rawChains)) throw new Error("chains must be an array");
    const chainNames = new Set<string>();
    const modelOwners = new Map<string, string>();
    chains = rawChains.map((value, index) => {
      if (!isRecord(value)) throw new Error(`chains[${index}] must be an object`);
      if (typeof value.name !== "string" || !value.name.trim()) {
        throw new Error(`chains[${index}].name must be a non-empty string`);
      }
      const name = value.name.trim();
      if (chainNames.has(name)) throw new Error(`duplicate chain name: ${name}`);
      chainNames.add(name);

      if (!Array.isArray(value.models)) throw new Error(`chains[${index}].models must be an array`);
      const models = value.models.map((model, modelIndex) => {
        if (typeof model !== "string") throw new Error(`chains[${index}].models[${modelIndex}] must be a string`);
        const key = model.trim();
        if (!splitModelKey(key)) throw new Error(`invalid model key: ${key}`);
        const owner = modelOwners.get(key);
        if (owner) throw new Error(`model ${key} appears in both '${owner}' and '${name}'`);
        modelOwners.set(key, name);
        return key;
      });
      if (models.length < 2) throw new Error(`chain '${name}' must contain at least two models`);
      return { name, models };
    });
  }
  if (enabled && chains.length === 0) throw new Error("enabled config must contain at least one valid chain");

  const maxFailovers = raw.maxFailoversPerRequest;
  if (
    maxFailovers !== undefined &&
    (typeof maxFailovers !== "number" || !Number.isInteger(maxFailovers) || maxFailovers < 0 || maxFailovers > 20)
  ) {
    throw new Error("maxFailoversPerRequest must be an integer between 0 and 20");
  }

  const rawStatuses = raw.retryableStatusCodes;
  let retryableStatusCodes = [...DEFAULT_CONFIG.retryableStatusCodes];
  if (rawStatuses !== undefined) {
    if (
      !Array.isArray(rawStatuses) ||
      rawStatuses.some((status) => typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599)
    ) {
      throw new Error("retryableStatusCodes must contain only HTTP 400-599 status integers");
    }
    retryableStatusCodes = [...new Set(rawStatuses)];
  }

  return {
    enabled,
    chains,
    maxFailoversPerRequest: (maxFailovers as number | undefined) ?? DEFAULT_CONFIG.maxFailoversPerRequest,
    requireNoToolCalls: optionalBoolean(raw, "requireNoToolCalls", DEFAULT_CONFIG.requireNoToolCalls),
    retryableStatusCodes,
    retryablePatterns: optionalStringArray(raw, "retryablePatterns", DEFAULT_CONFIG.retryablePatterns),
    nonRetryablePatterns: optionalStringArray(raw, "nonRetryablePatterns", DEFAULT_CONFIG.nonRetryablePatterns),
    retryInstruction: optionalString(raw, "retryInstruction", DEFAULT_CONFIG.retryInstruction),
    notify: optionalBoolean(raw, "notify", DEFAULT_CONFIG.notify)
  };
}

type ConfigLoadResult = { config: Config; error?: Error };

function loadConfig(fallback: Config = DEFAULT_CONFIG): ConfigLoadResult {
  if (!existsSync(CONFIG_PATH)) return { config: DEFAULT_CONFIG };
  try {
    return { config: normalizeConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))) };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    console.error(`[pi-auto-fallback] Failed to read ${CONFIG_PATH}:`, normalizedError);
    return { config: fallback, error: normalizedError };
  }
}

function splitModelKey(key: string): { provider: string; modelId: string } | undefined {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return undefined;
  return { provider: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

function modelKey(model: ExtensionContext["model"]): string | undefined {
  if (!model?.provider || !model?.id) return undefined;
  return `${model.provider}/${model.id}`;
}

function extractStatusCodes(text: string): number[] {
  const result = new Set<number>();
  for (const match of text.matchAll(/(?:status|http|error(?:\s+code)?|code)\s*[:=]?\s*([45]\d{2})\b/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) result.add(n);
  }
  return [...result];
}

export function isRetryable(errorText: string, config: Config, responseStatus?: number): boolean {
  const text = errorText.toLowerCase();

  if (config.nonRetryablePatterns.some((p) => text.includes(p.toLowerCase()))) return false;

  const statuses = responseStatus === undefined ? extractStatusCodes(text) : [responseStatus];
  if (statuses.some((s) => [400, 401, 403, 404, 422].includes(s))) return false;
  if (statuses.some((s) => config.retryableStatusCodes.includes(s))) return true;
  if (statuses.some((s) => s >= 500 && s <= 599)) return true;

  return config.retryablePatterns.some((p) => text.includes(p.toLowerCase()));
}

function findChainForModel(key: string, config: Config): ChainConfig | undefined {
  return config.chains.find((chain) => chain.models.includes(key));
}

function notify(
  ctx: ExtensionContext,
  config: Config,
  message: string,
  level: "info" | "warning" | "error" = "info"
) {
  if (!config.notify) return;
  try {
    ctx.ui?.notify?.(message, level);
  } catch {
    console.error(`[pi-auto-fallback] ${message}`);
  }
}

export function registerAutoFallback(pi: ExtensionAPI, initialConfig?: Config) {
  const initialLoad = initialConfig ? { config: initialConfig } : loadConfig();
  let config = initialLoad.config;
  let hadToolExecution = false;
  let pendingError: string | undefined;
  let pendingStatus: number | undefined;
  let lastResponseStatus: number | undefined;
  let attempted = new Set<string>();
  let failovers = 0;
  let rootRequestActive = false;
  let requestGeneration = 0;
  let lastFallback: { from: string; to: string; error: string } | undefined;

  const resetRequestState = () => {
    hadToolExecution = false;
    pendingError = undefined;
    pendingStatus = undefined;
    lastResponseStatus = undefined;
    attempted = new Set<string>();
    failovers = 0;
    rootRequestActive = true;
    requestGeneration += 1;
    lastFallback = undefined;
  };

  pi.on("input", async (event, ctx) => {
    // Only a real user/RPC input begins a new logical request.
    // Mid-stream steering/follow-ups and extension-injected retry instructions
    // belong to the current request and must preserve tool-safety state.
    if (event.source !== "extension" && event.streamingBehavior === undefined && ctx.isIdle()) {
      resetRequestState();
    }
    return { action: "continue" };
  });

  pi.on("tool_execution_start", async () => {
    hadToolExecution = true;
  });

  pi.on("after_provider_response", async (event) => {
    lastResponseStatus = event.status >= 400 ? event.status : undefined;
  });

  pi.on("message_end", async (event) => {
    const message = event.message;
    if (message?.role !== "assistant") return;

    const stopReason = String(message.stopReason ?? "").toLowerCase();
    const errorMessage = String(message.errorMessage ?? "");
    if (stopReason === "error" || errorMessage) {
      pendingError = errorMessage || `assistant stopReason=${stopReason}`;
      pendingStatus = lastResponseStatus;
    } else {
      // Pi may recover through its own retry/compaction before agent_settled.
      // The latest successful assistant message is authoritative.
      pendingError = undefined;
      pendingStatus = undefined;
    }
    lastResponseStatus = undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!config.enabled || !rootRequestActive || !pendingError) return;

    const generation = requestGeneration;
    const errorText = pendingError;
    const responseStatus = pendingStatus;
    pendingError = undefined;
    pendingStatus = undefined;

    if (!isRetryable(errorText, config, responseStatus)) {
      rootRequestActive = false;
      return;
    }

    if (config.requireNoToolCalls && hadToolExecution) {
      notify(ctx, config, "Auto fallback skipped: tools already executed in this request.", "warning");
      rootRequestActive = false;
      return;
    }

    if (failovers >= config.maxFailoversPerRequest) {
      notify(ctx, config, `Auto fallback exhausted after ${failovers} failover(s).`, "error");
      rootRequestActive = false;
      return;
    }

    const current = modelKey(ctx.model);
    if (!current) {
      rootRequestActive = false;
      return;
    }

    const chain = findChainForModel(current, config);
    if (!chain) {
      notify(ctx, config, `Auto fallback: no chain contains ${current}.`, "warning");
      rootRequestActive = false;
      return;
    }

    attempted.add(current);
    const currentIndex = chain.models.indexOf(current);
    const candidates = [
      ...chain.models.slice(currentIndex + 1),
      ...chain.models.slice(0, currentIndex)
    ].filter((key) => !attempted.has(key));

    const previousThinking = pi.getThinkingLevel();
    let selected: { key: string; model: NonNullable<ExtensionContext["model"]> } | undefined;

    for (const key of candidates) {
      const parsed = splitModelKey(key);
      if (!parsed) {
        attempted.add(key);
        continue;
      }

      const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
      if (!model) {
        attempted.add(key);
        continue;
      }

      let switched = false;
      try {
        switched = await pi.setModel(model);
      } catch (error) {
        if (generation !== requestGeneration) return;
        attempted.add(key);
        notify(
          ctx,
          config,
          `Auto fallback could not activate ${key}: ${error instanceof Error ? error.message : String(error)}`,
          "warning"
        );
        continue;
      }
      if (generation !== requestGeneration) return;
      if (!switched) {
        attempted.add(key);
        notify(ctx, config, `Auto fallback could not activate ${key}; trying next candidate.`, "warning");
        continue;
      }

      selected = { key, model };
      break;
    }

    if (!selected) {
      notify(ctx, config, `Auto fallback: no usable model remains in chain '${chain.name}'.`, "error");
      rootRequestActive = false;
      return;
    }

    // Pi clamps thinking level automatically if the target model supports fewer levels.
    pi.setThinkingLevel(previousThinking);

    attempted.add(selected.key);
    failovers += 1;
    lastFallback = { from: current, to: selected.key, error: errorText };
    hadToolExecution = false;

    notify(ctx, config, `Auto fallback: ${current} → ${selected.key}`, "warning");

    // At agent_settled Pi is idle, so this starts the retry immediately.
    // We intentionally add a short retry instruction instead of duplicating the
    // original user message; the original text/images remain in session context.
    if (generation === requestGeneration) pi.sendUserMessage(config.retryInstruction);
  });

  pi.registerCommand("fallback-status", {
    description: "Show pi-auto-fallback status and active chain",
    handler: async (_args, ctx) => {
      const current = modelKey(ctx.model) ?? "unknown";
      const chain = findChainForModel(current, config);
      const lines = [
        `enabled: ${config.enabled}`,
        `config: ${CONFIG_PATH}`,
        `current: ${current}`,
        `chain: ${chain?.name ?? "none"}`,
        `models: ${chain?.models.join(" -> ") ?? "n/a"}`,
        `failovers this request: ${failovers}/${config.maxFailoversPerRequest}`,
        `tool safety: ${config.requireNoToolCalls ? "on" : "off"}`,
        lastFallback ? `last fallback: ${lastFallback.from} -> ${lastFallback.to}` : "last fallback: none"
      ];
      if (ctx.mode === "tui") ctx.ui.notify(lines.join("\n"), "info");
      else console.log(lines.join("\n"));
    }
  });

  pi.registerCommand("fallback-reload", {
    description: `Reload ${CONFIG_PATH}`,
    handler: async (_args, ctx) => {
      const loaded = loadConfig(config);
      if (loaded.error) {
        notify(ctx, { ...config, notify: true }, `Auto fallback config unchanged: ${loaded.error.message}`, "error");
        return;
      }
      config = loaded.config;
      notify(ctx, { ...config, notify: true }, `Reloaded auto fallback config (${config.chains.length} chain(s)).`, "info");
    }
  });

  pi.registerCommand("fallback-reset", {
    description: "Reset auto-fallback state for the current request",
    handler: async (_args, ctx) => {
      resetRequestState();
      rootRequestActive = false;
      notify(ctx, config, "Auto fallback state reset.", "info");
    }
  });
}

export default function piAutoFallback(pi: ExtensionAPI) {
  registerAutoFallback(pi);
}
