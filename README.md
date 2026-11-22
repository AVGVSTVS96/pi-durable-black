# pi-durable-black

A Claude agent that stays alive: [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable) running in a Cloudflare Durable Object, with model calls routed through [`pi-black`](https://github.com/AVGVSTVS96/pi-black) so they use a Claude Max/Pro subscription instead of an API key.

Everything a conversation does — model turns, tool calls, scheduling, forks, your own documents — is committed to the Durable Object's SQLite storage before it is shown. If the isolate dies mid-turn, the next request resumes the work. Sockets hibernate; alarms wake the object when scheduled work is due.

This is a personal deployment, not a product. There is no multi-tenant isolation beyond one Durable Object per session, and no login UI for the app itself (see [Security](#security)).

## How it fits together

```
Browser ──WebSocket──▶ Worker ──▶ Session DO ──▶ pi-durable Harness
                                        │              │
                                        │              └── pi-ai Models ──▶ pi-black ──▶ api.anthropic.com
                                        │
                                        └── SQLite storage, alarms, hibernating sockets

CredentialVault DO ── owns the Claude credential, refreshes it single-threaded
```

- `src/agent.ts` composes the models, tools, extensions, and default agent. Anthropic is the only provider; its OAuth auth is replaced with a Worker-safe implementation from `pi-black/oauth`, and the provider is wrapped with pi-black's Claude Code wire compatibility.
- `src/credentials.ts` is a singleton Durable Object that holds the credential and refreshes it. Durable Objects handle one request at a time, so a refresh-token rotation can never race itself across sessions.
- `src/session.ts` hosts the harness for one session: Durable Object SQLite storage, hibernating WebSockets, alarms, and view streaming.
- `src/protocol.ts`, `src/client/` are the wire protocol and React client.

## Requirements

- Node.js 22.19 or newer, pnpm 11.
- pi-black, pinned in `package.json` to a specific commit. Point the dependency at a local checkout (`link:../pi-black`) while working on both.
- A Claude subscription credential: an OAuth access token, ideally with its refresh token.

## Get the credential

Sign in with Claude Code on a machine you control, then read the stored tokens:

```sh
jq -r '.claudeAiOauth.accessToken'  ~/.claude/.credentials.json
jq -r '.claudeAiOauth.refreshToken' ~/.claude/.credentials.json
```

On macOS the record lives in the login Keychain (`security find-generic-password -s "Claude Code-credentials" -w`). If the access token is empty, Claude Code's background daemon is holding the refreshed value; run a Claude Code command first, or use `claude setup-token`.

The Worker refreshes the access token itself when given the refresh token. With only an access token, calls stop working when it expires (a few hours).

## Run locally

```sh
pnpm install
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_OAUTH_TOKEN and ANTHROPIC_OAUTH_REFRESH_TOKEN
pnpm dev
```

Open the printed URL, create a session, send a message.

## Deploy

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put ANTHROPIC_OAUTH_TOKEN
pnpm exec wrangler secret put ANTHROPIC_OAUTH_REFRESH_TOKEN   # strongly recommended
pnpm deploy
```

Optional secrets: `CLAUDE_CODE_DEVICE_ID` and `CLAUDE_CODE_ACCOUNT_UUID` add the identity metadata Claude Code sends (pi-black reads them from `~/.claude.json` on a laptop); `PI_DURABLE_TOKEN` gates the API with a bearer token; `PI_DURABLE_MODEL` changes the default model.

The first model request makes the vault exchange the refresh token, so a bad credential fails immediately rather than at an arbitrary later time.

## Security

Anyone who can reach the Worker can spend your subscription quota. Pick one:

- Put the Worker behind Cloudflare Access and let it authenticate every request (recommended).
- Set `PI_DURABLE_TOKEN` and open the app once with `/?token=…`; the client keeps it in `sessionStorage` and sends it on the API and the WebSocket handshake.

The Worker never returns the credential to the browser. The vault stores it in the Durable Object's storage, which is encrypted at rest by Cloudflare.

## Operations

- **Token refresh** happens in the vault when less than five minutes remain. A failed refresh surfaces as an `oauth` model error; the stored credential is kept so a later request can retry.
- **Restarts** are normal. Committed turns survive; an in-flight model request is retried as a failed attempt (pi-durable bounds repeated failures).
- **Data** lives in the Session Durable Object's SQLite database. Deleting the object deletes the transcripts.
- **Cost**: requests are sent with Claude Code's request shape, so they draw on subscription usage. This is unofficial and version-sensitive; see pi-black's README for the current protocol version.

## Verify

```sh
pnpm check
```

Runs formatting, type generation, both typechecks, the workerd test suite, the production build, and a Wrangler deploy dry run. Tests never call a model provider: the harness tests use pi-ai's faux provider, and the provider test uses a capturing fetch.

## Layout

| Path                 | Owns                                                         |
| -------------------- | ------------------------------------------------------------ |
| `src/agent.ts`       | models, pi-black provider wiring, tools, default agent       |
| `src/credentials.ts` | credential vault DO and the pi-ai `CredentialStore` adapter  |
| `src/session.ts`     | one session's harness, storage, sockets, alarms              |
| `src/index.ts`       | Worker routing, bearer-token gate                            |
| `src/client/`        | React client, transcript view, activity panel                |
| `test/`              | protocol, recovery, scheduling, multiplayer, provider wiring |

## Credit

Forked from the official [`pi-durable-cloudflare`](https://github.com/earendil-works/pi-durable-cloudflare) example (MIT, © Earendil Works contributors). Upstream changes merge with `git fetch upstream && git merge upstream/main`. and on pi-black's Claude Code protocol work. The Claude Code OAuth client id and request conventions belong to Anthropic; this project is unaffiliated with Anthropic and with the upstream Pi project.
