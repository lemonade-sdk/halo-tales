# Developer guide

This is the practical guide for working on HaloTales itself. For the user-facing pitch, see the top-level [README](../README.md). For deeper-dive references, see:

- [`architecture.md`](architecture.md) — high-level component map and data flow
- [`agent-tools.md`](agent-tools.md) — every tool the AI can call, schema and dispatch
- [`story-format.md`](story-format.md) — the on-disk layout of `~/.cache/halo-tales`
- [`release-process.md`](release-process.md) — tagging, CI, and signing

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | Renderer build + Tauri CLI |
| Rust | stable (≥ 1.77) | Tauri 2 backend |
| Platform deps | varies | See below |

Platform-specific Tauri 2 prerequisites — follow the official guide once: <https://v2.tauri.app/start/prerequisites/>. On Ubuntu/Debian, the short version is:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssl-dev libayatana-appindicator3-dev
```

You'll also want a running [Lemonade](https://lemonade-server.ai/) on `localhost:13305` during development so you don't have to re-download the embedded copy every time you blow away `~/.cache/halo-tales`.

## Clone & install

```bash
git clone https://github.com/lemonade-sdk/halo-tales.git
cd halo-tales
npm install
```

## Daily dev loop

```bash
npm run dev          # = `tauri dev`
```

This runs:
1. `webpack serve` on `http://localhost:9234` for the renderer (HMR enabled)
2. `cargo run` for the Tauri shell, pointing the webview at the dev server
3. Auto-reloads the webview when you edit React/CSS; restarts the shell when you edit Rust

To work only on the renderer (faster iteration when you're not changing Rust):

```bash
npm run dev:renderer
```

## Lint / typecheck

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # same — there is no separate eslint config (yet)
```

Rust: `cargo fmt --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml`.

## Production build

```bash
npm run build          # `tauri build` — produces installers for the current OS
npm run build:nobundle # binary only, no installer (fast sanity check)
```

Outputs land in `src-tauri/target/release/bundle/`.

## Debugging

- **Renderer**: standard browser devtools — right-click → "Inspect Element" inside the Tauri window.
- **Tauri/IPC**: panics print to the terminal you launched `tauri dev` from. Add `eprintln!` in Rust freely.
- **Lemonade traffic**: every tool call goes over HTTP to `localhost:<lemonade-port>` and shows up in the renderer Network tab.
- **Agent decisions**: the chat completion payloads are visible in the Network tab too; expand any `/v1/chat/completions` request to see what the storyteller saw.

## Working without an embedded download

When iterating on lifecycle code, you don't want to re-download the embedded archive every time. Two options:

1. Keep the official Lemonade desktop app running — HaloTales will probe `localhost:13305` first and use it.
2. Pre-populate `~/.cache/halo-tales/embedded-lemonade/` once and leave it there; the probe-fallback path will reuse it on subsequent launches.

## Code map

| Path | What lives here |
|---|---|
| `src-tauri/src/lib.rs` | Tauri builder, command registration |
| `src-tauri/src/lemonade.rs` | Probe + download + spawn `lemond` |
| `src-tauri/src/download.rs` | Streamed archive download + extract (zip / tar.gz) |
| `src-tauri/src/story_fs.rs` | Story directory I/O |
| `src-tauri/src/commands.rs` | Every `#[tauri::command]` glued to the renderer |
| `src/index.tsx` + `src/App.tsx` | Renderer entry & top-level routing |
| `src/lemonade/lifecycle.ts` | Setup-screen state machine |
| `src/lemonade/client.ts` | `serverFetch` (auth + base URL) |
| `src/agent/agentLoop.ts` | Single-turn driver: chat → tool calls → repeat |
| `src/agent/omniRouterTools.ts` | image / TTS / STT HTTP calls |
| `src/agent/storyTools.ts` | Custom Tauri-backed tools (story.md, characters) |
| `src/agent/toolDefinitions.json` | Source of truth for tool schemas + system prompt |
| `src/story/repository.ts` | Renderer-side story CRUD over Tauri IPC |
| `src/components/*` | React UI |

## Adding a new agent tool

1. Add the schema to `src/agent/toolDefinitions.json`.
2. Implement execution in `src/agent/agentLoop.ts` (look at `dispatchTool`).
3. If it needs filesystem access, add a Rust command in `src-tauri/src/commands.rs` and bind it from `src/agent/storyTools.ts`.
4. Update [`agent-tools.md`](agent-tools.md).

## Known limitations / TODO

- No end-to-end test harness yet (the chat model is too large to run reliably in CI). Smoke-test against a local Lemonade server.
- Streaming chat completions are not used — the storyteller sends a full turn at once for simplicity.
