import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createChatHarnessOptions } from "../src/agent.ts";
import type { CredentialVault } from "../src/credentials.ts";

/** Writes a credential as if the vault had seeded it. */
const seedVault = (credential: unknown): Promise<void> =>
  runInDurableObject(
    env.CREDENTIALS.getByName("default") as DurableObjectStub<CredentialVault>,
    async (_instance, state) => {
      await state.storage.put("credentials", { anthropic: credential });
    },
  );

describe("credential vault", () => {
  it("serves a stored credential to the harness through Durable Object RPC", async () => {
    await seedVault({ type: "api_key", key: "sk-ant-oat-from-vault" });
    const options = createChatHarnessOptions(env);
    const models = typeof options.models === "function" ? options.models() : options.models;

    const auth = await models.getAuth("anthropic");
    expect(auth?.auth).toEqual({ apiKey: "sk-ant-oat-from-vault" });
    expect(await models.getAuth("anthropic").then((result) => result?.source)).toBe(
      "stored credential",
    );
  });

  it("lists and deletes stored credentials", async () => {
    await seedVault({ type: "api_key", key: "sk-ant-oat-to-delete" });
    const vault = env.CREDENTIALS.getByName("default");

    await expect(vault.listCredentials()).resolves.toEqual([
      { providerId: "anthropic", type: "api_key" },
    ]);
    await vault.logout("anthropic");
    await expect(vault.read("anthropic")).resolves.toBeUndefined();
  });

  it("returns no credential when the deployment has none", async () => {
    await seedVault(undefined);
    await runInDurableObject(
      env.CREDENTIALS.getByName("default") as DurableObjectStub<CredentialVault>,
      async (_instance, state) => {
        await state.storage.put("credentials", {});
      },
    );
    const vault = env.CREDENTIALS.getByName("default");
    await expect(vault.read("anthropic")).resolves.toBeUndefined();
  });
});
