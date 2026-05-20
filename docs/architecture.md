# Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React renderer (TypeScript)                                │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │ Start screen │ │  Story view  │ │  Wiki / Timeline   │   │
│  └──────┬───────┘ └──────┬───────┘ └─────────┬──────────┘   │
│         └─────── agent/agentLoop.ts ─────────┘              │
│                       │                                     │
│         ┌─────────────┼────────────────┐                    │
│         │             │                │                    │
│   omniRouterTools  storyTools     lemonade/client           │
└─────────┼─────────────┼─────────────────────────────────────┘
          │             │                │
          │      (Tauri IPC)        (HTTP — OpenAI-compatible)
          ▼             ▼                ▼
   ┌─────────────────────────┐    ┌───────────────────┐
   │ Rust (src-tauri)        │    │ lemond            │
   │ • lemonade.rs (spawn)   │◄───┤ chat / image /    │
   │ • story_fs.rs (md I/O)  │    │ tts / stt / pull  │
   │ • download.rs (archive) │    └───────────────────┘
   └─────────────────────────┘
```

## Boot sequence

1. **Tauri shell starts.** `paths::ensure_root()` makes `~/.cache/halo-tales/` and `stories/` exist.
2. **Renderer mounts.** `App.tsx` triggers `lifecycle.start()`.
3. **Lifecycle state machine** runs through:
   - `probing` — try `GET http://127.0.0.1:13305/api/v1/health`.
   - `downloading_lemonade` + `starting_lemonade` — only if the probe failed; downloads the platform-specific embeddable archive, extracts it under `~/.cache/halo-tales/embedded-lemonade/`, spawns `lemond` on a random free port, and waits for it to become healthy. The spawned process is held in `LemonadeState.child` and killed on app exit.
   - `checking_models` + `pulling_model` — calls `GET /api/v1/models?show_all=true`, then `POST /api/v1/pull` (streamed) for any of the four required models that aren't installed yet.
   - `ready` — populates `serverConfig` so the rest of the app can fire requests.
4. **App enters the Start screen.** From here every story turn is driven by `agentLoop.runTurn`.

## A single turn

```
user submits text
        │
        ▼
advanceStory(storyId, userText)
        │
        ▼
persistUserTurn → writes timeline/0042-user.md
        │
        ▼
runTurn({ storyId, userInput })
        │
        ▼
buildContext → reads story.md + characters/*.md
        │
        ▼
loop (max MAX_TOOL_ITERATIONS):
    POST /v1/chat/completions  (tools=[omni + story])
        ├── if no tool_calls → final narration
        │       break
        └── for each tool_call:
                dispatchTool(call, ctx)
                    ├── generate_image / edit_image → image bytes → ctx.output.imageB64
                    ├── text_to_speech → audio bytes → ctx.output.audioB64
                    └── read_*/update_*/upsert_*/list_* → Tauri IPC
                push 'tool' message back into the chat
        │
        ▼
persistTurn(storyId, 'scene', output) → writes 0043-scene.md, .png, .mp3
        │
        ▼
StoryView re-renders Timeline; new card autoplays its audio
```

## Security model

- The Tauri capability bundle (`src-tauri/capabilities/default.json`) scopes `fs:scope` to `$HOME/.cache/halo-tales/**`; nothing else on disk is readable from the renderer.
- `paths::sanitize_id` filters story IDs to `[A-Za-z0-9_-]` so a hostile renderer can't traverse out of the stories directory via `../`.
- Lemonade requests are bearer-auth'd with a per-launch random API key (when we spawned `lemond` ourselves). System-Lemonade requests use whatever auth that copy is configured for (none by default).
- The embedded `lemond` is spawned with `current_dir` set to its own directory and `kill_on_drop`, so quitting HaloTales kills it.

## Why this layout

- **Renderer drives the agent loop, not Rust.** The agent loop is mostly HTTP plumbing and JSON munging — the kind of code that's much shorter and faster to iterate on in TypeScript. The Rust side owns only the things that *have* to be there (process spawning, filesystem, packaging).
- **Stories live in `~/.cache/halo-tales/`, not Tauri's app dir.** Uninstalling the app should not delete the user's stories or the multi-GB lemonade install. `~/.cache` is the right home for "regeneratable but expensive to redownload" data.
- **Tool definitions live in JSON, not code.** `toolDefinitions.json` is the single source of truth for both the system prompt's tool list and the request payload; we never get out of sync.
