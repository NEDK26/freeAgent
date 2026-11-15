import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRetryable, normalizeConfig, registerAutoFallback, type Config } from "../vendor/pi-auto-fallback/index.ts";

type Handler = (event: any, context: any) => Promise<unknown>;

function testConfig(overrides: Partial<Config> = {}): Config {
  return normalizeConfig({
    enabled: true,
    chains: [{ name: "test", models: ["provider/a", "provider/b", "provider/c"] }],
    maxFailoversPerRequest: 2,
    requireNoToolCalls: true,
    retryableStatusCodes: [429, 500, 502, 503, 504, 524],
    retryablePatterns: ["timeout"],
    nonRetryablePatterns: ["unauthorized"],
    retryInstruction: "retry previous request",
    notify: true,
    ...overrides
  });
}

function setup(config = testConfig()) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const notifications: string[] = [];
  const sentMessages: string[] = [];
  const setModelCalls: Array<{ provider: string; id: string }> = [];
  let currentModel = { provider: "provider", id: "a" };
  let idle = true;
  let setModelImpl = async (model: { provider: string; id: string }) => {
    currentModel = model;
    return true;
  };

  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: { handler: Handler }) {
      commands.set(name, command.handler);
    },
    getThinkingLevel() {
      return "medium";
    },
    setThinkingLevel() {},
    async setModel(model: { provider: string; id: string }) {
      setModelCalls.push(model);
      return setModelImpl(model);
    },
    sendUserMessage(message: string) {
      sentMessages.push(message);
    }
  } as unknown as ExtensionAPI;

  const context = {
    get model() {
      return currentModel;
    },
    modelRegistry: {
      find(provider: string, id: string) {
        return { provider, id };
      }
    },
    isIdle() {
      return idle;
    },
    mode: "tui",
    ui: {
      notify(message: string) {
        notifications.push(message);
      }
    }
  };

  registerAutoFallback(pi, config);

  return {
    handlers,
    commands,
    context,
    notifications,
    sentMessages,
    setModelCalls,
    setIdle(value: boolean) {
      idle = value;
    },
    setSetModelImpl(impl: typeof setModelImpl) {
      setModelImpl = impl;
    }
  };
}

async function emit(subject: ReturnType<typeof setup>, name: string, event: Record<string, unknown>) {
  const handler = subject.handlers.get(name);
  assert.ok(handler, `missing handler for ${name}`);
  return handler(event, subject.context);
}

test("a successful Pi retry clears the earlier provider error", async () => {
  const subject = setup();
  await emit(subject, "input", { source: "interactive" });
  await emit(subject, "message_end", {
    message: { role: "assistant", stopReason: "error", errorMessage: "HTTP 503 unavailable" }
  });
  await emit(subject, "message_end", {
    message: { role: "assistant", stopReason: "stop", errorMessage: "" }
  });
  await emit(subject, "agent_settled", {});

  assert.equal(subject.setModelCalls.length, 0);
  assert.equal(subject.sentMessages.length, 0);
});

test("mid-stream follow-up input does not clear tool replay protection", async () => {
  const subject = setup();
  await emit(subject, "input", { source: "interactive" });
  await emit(subject, "tool_execution_start", {});
  subject.setIdle(false);
  await emit(subject, "input", { source: "interactive", streamingBehavior: "followUp" });
  subject.setIdle(true);
  await emit(subject, "message_end", {
    message: { role: "assistant", stopReason: "error", errorMessage: "timeout" }
  });
  await emit(subject, "agent_settled", {});

  assert.equal(subject.setModelCalls.length, 0);
  assert.match(subject.notifications.join("\n"), /tools already executed/);
});

test("structured provider status triggers fallback without parsing error text", async () => {
  const subject = setup();
  await emit(subject, "input", { source: "interactive" });
  await emit(subject, "after_provider_response", { status: 503, headers: {} });
  await emit(subject, "message_end", {
    message: { role: "assistant", stopReason: "error", errorMessage: "request failed" }
  });
  await emit(subject, "agent_settled", {});

  assert.deepEqual(subject.setModelCalls, [{ provider: "provider", id: "b" }]);
  assert.deepEqual(subject.sentMessages, ["retry previous request"]);
});

test("an unrelated three-digit number is not treated as an HTTP status", () => {
  assert.equal(isRetryable("max_tokens must be at least 512", testConfig()), false);
  assert.equal(isRetryable("HTTP 503 unavailable", testConfig()), true);
});

test("a new root request prevents a stale settled handler from injecting a retry", async () => {
  const subject = setup();
  let resolveSwitch: ((value: boolean) => void) | undefined;
  subject.setSetModelImpl(
    () =>
      new Promise<boolean>((resolve) => {
        resolveSwitch = resolve;
      })
  );

  await emit(subject, "input", { source: "interactive" });
  await emit(subject, "message_end", {
    message: { role: "assistant", stopReason: "error", errorMessage: "timeout" }
  });
  const settling = emit(subject, "agent_settled", {});
  assert.ok(resolveSwitch);
  await emit(subject, "input", { source: "interactive" });
  resolveSwitch(true);
  await settling;

  assert.equal(subject.sentMessages.length, 0);
});

test("configuration parsing rejects unsafe types and ambiguous chains", () => {
  assert.throws(() => normalizeConfig({ enabled: "false" }), /enabled must be a boolean/);
  assert.throws(
    () =>
      normalizeConfig({
        enabled: true,
        chains: [
          { name: "one", models: ["provider/a", "provider/b"] },
          { name: "two", models: ["provider/a", "provider/c"] }
        ]
      }),
    /appears in both/
  );
  assert.throws(
    () => normalizeConfig({ enabled: true, chains: [{ name: "one", models: ["provider/a"] }] }),
    /at least two models/
  );
});
