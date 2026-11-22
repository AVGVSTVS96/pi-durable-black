# pi-durable-black

A Claude agent that stays alive: [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable) running in a Cloudflare Durable Object, with model calls routed through [`pi-black`](https://github.com/AVGVSTVS96/pi-black) so they bill a Claude Max/Pro subscription instead of an API key.

Everything a conversation does (model turns, tool calls, schedules, forks, documents) is written to the Durable Object's SQLite storage before it's shown. If the isolate dies mid-turn, the next request picks the work back up. Sockets hibernate, and alarms wake the object when scheduled work is due.

This is a personal deployment, not a product. Each session gets its own Durable Object and there's no login UI; see [Security](#security) for how to lock it down.

## How it fits together

```
Browser ──WebSocket──▶ Worker ──▶ Session DO ──▶ pi-durable Harness
                                      │                │
                                      │                └─▶ pi-ai ──▶ pi-black ──▶ api.anthropic.com
                                      │
                                      └─ SQLite storage, alarms, hibernating sockets

CredentialVault DO ── holds the Claude credential and refreshes it, one request at a time
```

| Path                 | Owns                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `src/agent.ts`       | models, pi-black provider wiring, tools, default agent                   |
| `src/credentials.ts` | the credential vault DO and the pi-ai `CredentialStore` that talks to it |
| `src/session.ts`     | one session's harness, storage, sockets, alarms                          |
| `src/index.ts`       | Worker routing and the bearer-token gate                                 |
| `src/protocol.ts`    | the WebSocket protocol shared by Worker and client                       |
| `src/client/`        | React client, transcript, activity panel                                 |
| `test/`              | protocol, recovery, scheduling, multiplayer, auth, provider wiring       |

Anthropic is the only provider. Its OAuth handling is swapped for a Worker-safe version from `pi-black/oauth`, and requests go out in Claude Code's shape via pi-black's provider wrapper.

The vault is a single Durable Object so refreshes can't race: refresh tokens rotate on use, and two sessions refreshing at once would invalidate each other.

## Requirements

- Node.js 22.19+ and pnpm 11.
- pi-black, pinned to a commit in `package.json`. Use `link:../pi-black` while working on both.
- A Claude subscription credential: an OAuth access token, ideally with its refresh token.

## Get the credential

Sign in with Claude Code on a machine you control, then read the tokens:

```sh
jq -r '.claudeAiOauth.accessToken'  ~/.claude/.credentials.json
jq -r '.claudeAiOauth.refreshToken' ~/.claude/.credentials.json
```

On macOS they're in the login Keychain instead: `security find-generic-password -s "Claude Code-credentials" -w`. If the access token comes back empty, run any Claude Code command first, or use `claude setup-token`.

With the refresh token, the Worker keeps the access token fresh on its own. With only the access token, calls stop when it expires, after a few hours.

## Run locally

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_OAUTH_TOKEN and ANTHROPIC_OAUTH_REFRESH_TOKEN
pnpm dev
```

Open the printed URL, start a session, send a message.

## Deploy

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put ANTHROPIC_OAUTH_TOKEN
pnpm exec wrangler secret put ANTHROPIC_OAUTH_REFRESH_TOKEN
pnpm deploy
```

Optional secrets:

| Secret                                              | What it does                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PI_DURABLE_TOKEN`                                  | requires a bearer token on `/api/*`                                                    |
| `PI_DURABLE_MODEL`                                  | default model id (`claude-sonnet-5-5` if unset)                                        |
| `CLAUDE_CODE_DEVICE_ID`, `CLAUDE_CODE_ACCOUNT_UUID` | identity metadata Claude Code sends; pi-black reads them from `~/.claude.json` locally |
| `ANTHROPIC_API_KEY`                                 | plain API key fallback, billed per token, used only when no OAuth token is set         |

The vault exchanges the refresh token on the first model request, so a bad credential fails right away instead of hours later.

## Security

Anyone who can reach the Worker can spend your subscription. Pick one:

- Put it behind Cloudflare Access (recommended).
- Set `PI_DURABLE_TOKEN` and open the app once with `/?token=…`. The client keeps the token in `sessionStorage`, strips it from the address bar, and sends it on API calls and the WebSocket handshake.

The credential never reaches the browser. It lives in the vault's Durable Object storage, which Cloudflare encrypts at rest.

## Operations

- **Token refresh** happens in the vault when less than five minutes remain. A failed refresh shows up as an `oauth` model error, and the stored credential is kept so the next request retries.
- **Restarts** are normal. Committed turns survive; an in-flight model request is retried, and pi-durable caps repeated failures.
- **Data** lives in each Session Durable Object's SQLite database. Deleting the object deletes its transcripts.
- **Billing**: requests use Claude Code's request shape, so they draw on subscription usage. This is unofficial and breaks when Claude Code's protocol changes; pi-black's README tracks the current version.

## Develop

```sh
pnpm format   # oxfmt
pnpm lint     # oxlint
pnpm test     # vitest in workerd
pnpm check    # all of the above, type generation, both typechecks, build, deploy dry run
```

Tests never call a real model: harness tests use pi-ai's faux provider, and the provider test captures `fetch`.

## Credit

Forked from Earendil Works' [`pi-durable-cloudflare`](https://github.com/earendil-works/pi-durable-cloudflare) example (MIT). Pull upstream changes with `git fetch upstream && git merge upstream/main`. The Claude Code protocol work lives in [pi-black](https://github.com/AVGVSTVS96/pi-black).

The Claude Code OAuth client id and request conventions belong to Anthropic. This project isn't affiliated with Anthropic or the Pi project.
