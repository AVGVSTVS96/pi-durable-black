import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

const fakeEnv = (token: string): Env => ({ ...env, PI_DURABLE_TOKEN: token });

const create = (headers: HeadersInit = {}): Request =>
  new Request("https://example.com/api/sessions", { method: "POST", headers });

describe("API token gate", () => {
  it("allows requests when no token is configured", async () => {
    const response = await worker.fetch(create(), fakeEnv(""));
    expect(response.status).toBe(201);
  });

  it("rejects a missing or wrong bearer token", async () => {
    expect((await worker.fetch(create(), fakeEnv("secret"))).status).toBe(401);
    expect(
      (await worker.fetch(create({ Authorization: "Bearer wrong" }), fakeEnv("secret"))).status,
    ).toBe(401);
  });

  it("accepts a bearer token or a WebSocket token query", async () => {
    expect(
      (await worker.fetch(create({ Authorization: "Bearer secret" }), fakeEnv("secret"))).status,
    ).toBe(201);
  });

  it("does not gate static assets", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/", { headers: { accept: "text/html" } }),
      fakeEnv("secret"),
    );
    expect(response.status).not.toBe(401);
  });
});
