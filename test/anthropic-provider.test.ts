import type { FetchFunction } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createChatHarnessOptions } from "../src/agent.ts";

const DEVICE_ID = "a".repeat(64);
const ACCOUNT_UUID = "11111111-2222-4333-8444-555555555555";

type Captured = {
  readonly body: string;
  readonly headers: Headers;
};

/** A transport that records the request and ends the stream without a model call. */
const captureFetch = (): { fetch: FetchFunction; captured: () => Captured | undefined } => {
  let captured: Captured | undefined;
  const fetch: FetchFunction = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const body =
      typeof init?.body === "string"
        ? init.body
        : request === undefined
          ? ""
          : await request.clone().text();
    const headers = new Headers(request?.headers);
    for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
    captured = { body, headers };
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { fetch, captured: () => captured };
};

describe("pi-black anthropic wiring", () => {
  it("sends an OAuth request through the Claude Code wire format", async () => {
    const options = createChatHarnessOptions({
      ANTHROPIC_OAUTH_TOKEN: "sk-ant-oat-test",
      CLAUDE_CODE_DEVICE_ID: DEVICE_ID,
      CLAUDE_CODE_ACCOUNT_UUID: ACCOUNT_UUID,
    });
    const models = typeof options.models === "function" ? options.models() : options.models;
    const model = models.getModel("anthropic", "claude-sonnet-5-5");
    expect(model).toBeDefined();

    const transport = captureFetch();
    const stream = models.stream(
      model!,
      { messages: [{ role: "user", content: "Reply with exactly: ok", timestamp: Date.now() }] },
      { fetch: transport.fetch, sessionId: "session-under-test" },
    );
    // The fake transport ends the stream early; the request is what this test asserts.
    await stream.result().catch(() => undefined);

    const captured = transport.captured();
    expect(captured).toBeDefined();
    const body = JSON.parse(captured!.body) as {
      system: Array<{ type: string; text: string }>;
      metadata?: { user_id?: string };
    };
    expect(body.system[0]?.text).toMatch(
      /^x-anthropic-billing-header: cc_version=2\.1\.330\.[0-9a-f]{3}; cc_entrypoint=sdk-cli; cch=[0-9a-f]{5};$/u,
    );
    expect(body.system[1]?.text).toBe(
      "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    );
    expect(captured!.headers.get("x-app")).toBe("cli");
    expect(captured!.headers.get("user-agent")).toMatch(/^claude-cli\/2\.1\.330 /u);
    expect(captured!.headers.get("x-client-request-id")).toBeTruthy();
    expect(JSON.parse(body.metadata!.user_id!)).toEqual({
      device_id: DEVICE_ID,
      account_uuid: ACCOUNT_UUID,
      session_id: "session-under-test",
    });
  });

  it("leaves API-key requests untouched", async () => {
    const options = createChatHarnessOptions({ ANTHROPIC_API_KEY: "sk-ant-api03-test" });
    const models = typeof options.models === "function" ? options.models() : options.models;
    const model = models.getModel("anthropic", "claude-sonnet-5-5");
    const transport = captureFetch();
    const stream = models.stream(
      model!,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { fetch: transport.fetch },
    );
    await stream.result().catch(() => undefined);

    const body = JSON.parse(transport.captured()!.body) as {
      system?: unknown;
      metadata?: unknown;
    };
    expect(body.metadata).toBeUndefined();
    // No billing block is injected for a plain API key.
    expect(JSON.stringify(body.system ?? [])).not.toContain("x-anthropic-billing-header");
  });
});
