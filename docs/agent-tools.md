# Agent tools

The storyteller calls tools through the standard OpenAI tool-calling protocol. The full set is declared in [`src/agent/toolDefinitions.json`](../src/agent/toolDefinitions.json) — that JSON file is the source of truth, both for the schemas the LLM sees and for the rendered system prompt.

There are two families of tools.

## 1. OmniRouter tools

These hit Lemonade's OpenAI-compatible endpoints directly. Implementation: [`src/agent/omniRouterTools.ts`](../src/agent/omniRouterTools.ts).

| Tool | Endpoint | Purpose |
|---|---|---|
| `generate_image(prompt)` | `POST /api/v1/images/generations` | Brand-new illustration for a scene |
| `edit_image(prompt)` | `POST /api/v1/images/edits` | Tweak the most recent illustration |
| `text_to_speech(input, voice)` | `POST /api/v1/audio/speech` | Narrate the scene aloud |

Plus the renderer (not the agent) uses `transcribeAudio()` to turn the user's spoken turn input into text — that lives in `omniRouterTools.ts` but isn't exposed to the LLM.

The base64 audio/image bytes the agent receives are immediately handed to `persistTurn`, which writes them into the story's `timeline/` directory next to the markdown for that turn.

## 2. Story tools (Tauri IPC)

These are HaloTales-specific. They round-trip into Rust commands defined in [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs), which read/write under `~/.cache/halo-tales/stories/<story-id>/`.

| Tool | Effect | Backing command |
|---|---|---|
| `read_story_summary()` | Return `story.md` | `read_story_summary` |
| `update_story_summary(content)` | Overwrite `story.md` | `write_story_summary` |
| `list_characters()` | Names + bios of all characters | `list_characters` |
| `read_character(name)` | Return one character's full sheet | `read_character` |
| `upsert_character(name, content)` | Create/overwrite a character sheet | `upsert_character` |
| `end_story(outcome, epilogue)` | Mark the story finished | `update_story_meta` (status flip) |

All character `name` values are sanitized to `[A-Za-z0-9_-]` server-side, so the LLM can't traverse out of the story dir via the tool surface.

## Dispatch flow

```
chat completion → message.tool_calls
       │
       ▼
for each call:
   dispatchTool(call, ctx, signal)
   (see src/agent/agentLoop.ts:dispatchTool)
       │
       ├─ omni:  call omniRouterTools.* → ctx.output (image/audio in memory)
       └─ story: call storyApi.*        → side effects on disk
```

The dispatch result is serialized into a `{role:'tool', tool_call_id, content}` message and pushed back into the conversation. The model can read its own tool output on the next iteration.

## Adding a new tool

1. Add the JSON schema entry to `src/agent/toolDefinitions.json`. Include a `requires_role` hint (`image`, `tts`, `transcription`) if it needs a specific model role.
2. Handle the name in `dispatchTool` inside `agentLoop.ts`.
3. If it touches disk: add a `#[tauri::command]` in `src-tauri/src/commands.rs`, wire it into `lib.rs`'s `invoke_handler!`, and add a typed binding in `src/agent/storyTools.ts`.
4. Test by giving the storyteller a prompt that forces the tool to be called.

## System prompt

The persona + tool-usage guidance lives in the `system_prompt` field of `toolDefinitions.json`. `buildSystemPrompt()` in `src/agent/systemPrompts.ts` interpolates the live list of tool names so the prompt always matches what's available.
