import { DurableObject } from "cloudflare:workers";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { refreshAnthropicOAuth } from "pi-black/oauth";

const PROVIDER_ID = "anthropic";
const STORAGE_KEY = "credentials";
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

type Credentials = Record<string, Credential>;

export class CredentialVault extends DurableObject<Env> {
  #pending: Promise<Credential | undefined> | undefined;

  async read(providerId: string): Promise<Credential | undefined> {
    const stored = await this.#load(providerId);
    if (stored?.type !== "oauth") return stored;
    if (stored.expires > Date.now() + EXPIRY_SKEW_MS) return stored;
    return this.#refresh(providerId);
  }

  async refresh(providerId: string): Promise<Credential | undefined> {
    return this.#refresh(providerId);
  }

  async listCredentials(): Promise<CredentialInfo[]> {
    const all = await this.#seed();
    return Object.entries(all).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async logout(providerId: string): Promise<void> {
    const all = await this.#seed();
    delete all[providerId];
    await this.ctx.storage.put(STORAGE_KEY, all);
  }

  async #load(providerId: string): Promise<Credential | undefined> {
    return (await this.#seed())[providerId];
  }

  async #seed(): Promise<Credentials> {
    const existing = await this.ctx.storage.get<Credentials>(STORAGE_KEY);
    if (existing !== undefined && Object.keys(existing).length > 0) return existing;

    const access = this.env.ANTHROPIC_OAUTH_TOKEN;
    const refresh = this.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
    const all: Credentials = {};
    if (access && refresh) {
      all[PROVIDER_ID] = { type: "oauth", access, refresh, expires: 0 };
    } else if (access) {
      all[PROVIDER_ID] = { type: "api_key", key: access };
    } else if (this.env.ANTHROPIC_API_KEY) {
      all[PROVIDER_ID] = { type: "api_key", key: this.env.ANTHROPIC_API_KEY };
    }
    if (Object.keys(all).length > 0) await this.ctx.storage.put(STORAGE_KEY, all);
    return all;
  }

  async #refresh(providerId: string): Promise<Credential | undefined> {
    this.#pending ??= this.#refreshOnce(providerId).finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #refreshOnce(providerId: string): Promise<Credential | undefined> {
    const all = await this.#seed();
    const stored = all[providerId];
    if (stored === undefined) return undefined;
    if (stored.type === "api_key") return stored;
    if (stored.expires > Date.now() + EXPIRY_SKEW_MS) return stored;
    if (stored.refresh.length === 0) {
      throw new Error(
        "The Claude credential expired and has no refresh token; store ANTHROPIC_OAUTH_REFRESH_TOKEN",
      );
    }
    const refreshed = await refreshAnthropicOAuth(stored.refresh);
    all[providerId] = refreshed;
    await this.ctx.storage.put(STORAGE_KEY, all);
    return refreshed;
  }
}

export class AccountCredentialStore implements CredentialStore {
  readonly #vault: DurableObjectStub<CredentialVault>;

  constructor(vault: DurableObjectStub<CredentialVault>) {
    this.#vault = vault;
  }

  read(providerId: string): Promise<Credential | undefined> {
    return this.#vault.read(providerId);
  }

  list(): Promise<readonly CredentialInfo[]> {
    return this.#vault.listCredentials();
  }

  modify(providerId: string): Promise<Credential | undefined> {
    return this.#vault.refresh(providerId);
  }

  async delete(providerId: string): Promise<void> {
    await this.#vault.logout(providerId);
  }
}
