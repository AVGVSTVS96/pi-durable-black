import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  configure,
  createRegistry,
  defineExtension,
  section,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { wrapAnthropicProvider } from "pi-black/provider";
import { anthropicOAuthForWorkers } from "pi-black/oauth";
import { discoverClaudeCodeIdentity } from "pi-black/protocol";
import { DeliverScheduledInstruction } from "./schedule.ts";
import { conversationSearchExtension, searchHistoryTool } from "./search.ts";
import { getWeatherTool, scheduleTool } from "./tools.ts";
import { AccountCredentialStore, type CredentialVault } from "./credentials.ts";

export interface AgentBindings {
  readonly ANTHROPIC_OAUTH_TOKEN?: unknown;
  readonly ANTHROPIC_API_KEY?: unknown;
  readonly CLAUDE_CODE_DEVICE_ID?: unknown;
  readonly CLAUDE_CODE_ACCOUNT_UUID?: unknown;
  readonly PI_DURABLE_MODEL?: unknown;
  readonly CREDENTIALS?: DurableObjectNamespace<CredentialVault>;
}

const DEFAULT_MODEL = "claude-sonnet-5-5";

const STRING_BINDINGS = [
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_DEVICE_ID",
  "CLAUDE_CODE_ACCOUNT_UUID",
  "PI_DURABLE_MODEL",
] as const;

function readBindings(env: AgentBindings): Record<string, string | undefined> {
  const bindings: Record<string, string | undefined> = {};
  for (const name of STRING_BINDINGS) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0) bindings[name] = value;
  }
  return bindings;
}

export function createChatHarnessOptions(env: AgentBindings = {}): HarnessOptions {
  const bindings = readBindings(env);
  const credentials =
    env.CREDENTIALS === undefined
      ? undefined
      : new AccountCredentialStore(env.CREDENTIALS.getByName("default"));
  const models = createModels({
    ...(credentials === undefined ? {} : { credentials }),
    authContext: {
      env: async (name) => bindings[name],
      fileExists: async () => false,
    },
  });
  const anthropic = anthropicProvider();
  models.setProvider(
    wrapAnthropicProvider(
      {
        ...anthropic,
        auth: { ...anthropic.auth, oauth: anthropicOAuthForWorkers() },
      },
      discoverClaudeCodeIdentity(bindings),
    ),
  );

  const chatExtension = defineExtension({
    name: "chat",
    tasks: [DeliverScheduledInstruction],
    tools: [getWeatherTool, scheduleTool, searchHistoryTool],
    sections: [
      section(
        "preamble",
        () =>
          "You are a concise assistant running inside a durable conversation. User messages may begin with a display name in brackets; treat it as speaker attribution.",
        { tag: false },
      ),
      section("clock", () => `Current time: ${new Date().toISOString().slice(0, 16)}Z.`, {
        tag: false,
      }),
    ],
  });
  const registry = createRegistry();
  registry.install(chatExtension);
  registry.install(conversationSearchExtension);
  const defaultAgent = {
    model: {
      provider: "anthropic",
      modelId: bindings.PI_DURABLE_MODEL ?? DEFAULT_MODEL,
    },
    thinkingLevel: "off" as const,
    tools: [getWeatherTool, scheduleTool, searchHistoryTool],
  };

  return {
    models,
    registry,
    settings: { extensions: [chatExtension] },
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, defaultAgent)
        : undefined,
  };
}
