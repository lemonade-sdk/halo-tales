# HaloTales — running a debug loop with Claude

This file is for any AI assistant (or human pairing with one) about to debug
HaloTales. It explains the tight feedback loop we used to bring the app up
end-to-end so a new session can drop straight into it.

## The setup

- HaloTales is a Tauri 2 + React + TypeScript app. The renderer is webpack-
  dev-served at `http://localhost:9234`; the Rust shell talks to Lemonade
  OmniRouter (`http://127.0.0.1:13305`) for chat / image / TTS / STT.
- All app behavior — Rust side and renderer — funnels into a single log
  file: `~/.cache/halo-tales/halo-tales.log`.
- The user runs the app (`npm run dev` from the repo root). The assistant
  cannot see the app window or the dev terminal; the log file is the only
  signal channel.

## The feedback loop

1. Assistant edits files. `tauri dev` watches:
   - **`src/**`** — webpack-dev-server hot-reloads the renderer in place.
   - **`src-tauri/**`** — Rust gets rebuilt and the binary restarts
     automatically (look for a fresh `boot: halo-tales starting…` line).
   - **`src-tauri/tauri.conf.json`** — same: rebuilds Rust. Allow ~5–10 s.
2. Assistant arms a `Monitor` over the log so each milestone arrives as a
   notification (see "Monitoring" below).
3. User clicks "Begin" / "Take your turn" / navigates in the app.
4. Assistant reads the streamed events, diagnoses, edits, and loops.

The user does **not** narrate what they see — they trust the log to surface
the failure mode. When something is wrong that the log doesn't capture, the
assistant's first move is to *add the missing log line*, then ask the user
to retry.

## Logging (read this before writing more)

There is one log file and two writers. Use the existing helpers; do not
invent new sinks.

- **Rust side**: `src-tauri/src/logging.rs` exposes the `log_event` Tauri
  command and the `crate::hlog!("level", "scope", "fmt {}", args)` macro
  used inside the crate. Output goes to both `eprintln!` and the log file.
- **Renderer side**: `src/util/logger.ts` exports `makeLogger(scope)`
  → `{ debug, info, warn, error }`. Calls mirror to the devtools console
  AND invoke `log_event` so they land in the same file. The renderer also
  installs window-error / unhandled-rejection capture.

Use a scope name per area (`agent`, `story`, `turn`, `lifecycle`, …). Log
lines look like:

```
[1779392377.582] info  agent: runTurn: begin {"storyId":"…","opening":true,…}
```

## Monitoring

Use the `Monitor` tool with `tail -F` plus a tight `grep -E
--line-buffered "…"` so only meaningful events fire notifications. The
canonical filter for an agent run (used in this session) is something like:

```
createNewStory|runTurn|tool_call|generate_image OK|text_to_speech|dispatchTool threw|image data url|audio data url|img onLoad|img onError|audio onError|TurnCard|tool_choice|reasoningChars|finish_reason|audio desync|TTS re-narrated|Lemonade error|backend returned|error |Error|unhandled|uncaught
```

Pick the longest reasonable `timeout_ms` (3,600,000 = 1 h). Re-arm when it
expires only if the user is actively engaged — otherwise wait silently.

## Typical investigation shape

Every bug we shipped a fix for followed the same arc:

1. **Reproduce in the log.** If the failure isn't visible there, instrument
   first. Resist the urge to guess.
2. **Read the raw bytes**, not just the headline. `data.error.message`
   inside a 200 OK, `finish_reason=length`, `reasoningChars=21776`,
   missing `img onLoad` are all real signals.
3. **Inspect disk state.** `~/.cache/halo-tales/stories/<uuid>/` is the
   source of truth: meta.json, story.md (the wiki), characters/,
   timeline/. Mismatch between disk and what the UI shows = bug.
4. **Cross-check the source.** `cargo` + the actual crate source at
   `~/.cargo/registry/src/.../tauri-2.x/` answers protocol / scope /
   matching questions definitively. Do not trust web search alone.
5. **One root cause per fix, then verify.** Land the fix; let the next
   monitor event prove it.

## Build commands

From the repo root:

```bash
npm install              # one-time
npm run dev              # webpack-dev-server on :9234 + Tauri shell
npm run typecheck        # tsc --noEmit (fast; run after every renderer edit)
cargo check --manifest-path src-tauri/Cargo.toml   # run after every Rust edit
```

## What not to do

- Don't restart `tauri dev` yourself — the user controls that process.
- Don't `rm -rf ~/.cache/halo-tales` or delete stories without asking; that
  cache also holds the embedded Lemonade install and the user's previous
  runs (which are useful debug evidence).
- Don't `console.log`. Use `makeLogger(scope)` so the line lands in the
  shared file.
- Don't add backfill / fallback logic to work around a model behavior
  before instrumenting it. Most of our "mystery" failures had a one-line
  cause once we logged the right field (`finish_reason`,
  `reasoning_content`, `audioSourceText`, the actual file path on disk).
