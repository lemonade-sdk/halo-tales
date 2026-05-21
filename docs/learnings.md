# Learnings

A running log of non-obvious problems encountered while developing HaloTales
and what we ended up doing about them. Each table is themed; rows pair a
concrete failure mode with the fix.

## Bootstrapping with Lemonade OmniRouter

| Problem | Resolution |
| --- | --- |
| `probe_lemonade` returned the same `13305` as the *desktop* Lemonade install while the embedded `lemond` we spawned was actually listening on a different port (e.g. `44207`), making the renderer hit the wrong server. | Always use the endpoint returned by `start_embedded_lemonade` (not the default URL); `LemonadeState.set_endpoint` is the source of truth for the renderer. |
| FLUX image gen suddenly returned `HTTP 500 generate_image returned no results` for any prompt; reproducible with `curl` outside the app. | Not a HaloTales bug — the embedded `sd-server` had wedged. A Lemonade restart cleared it. Worth checking with a direct `curl /api/v1/images/generations` before assuming it's your code. |
| Title naming took 32 s on the first chat call of the session vs ~1 s on subsequent calls. | Lemonade lazily loads chat models on first request — that 32 s was the 35B MoE being read into VRAM, not a warmup pass. Surface it in the UI (the "Naming the tale" step has its own spinner) and don't conflate it with the agent loop's "thinking" state. Calling a tiny chat completion eagerly during app start can shift the wait off the user's first turn. |
| `min_p`, `top_k`, and `chat_template_kwargs` are llama.cpp extensions that some servers reject with 400/422. | Send them anyway and keep a retry path in `postChatCompletion` that strips them on 400/422 — both directions are common across Lemonade builds. |

## Qwen3 thinking-mode and tool calling

| Problem | Resolution |
| --- | --- |
| With `enable_thinking: false`, the model called **zero** tools and just wrote prose, even when the system prompt explicitly required four tool calls per turn. | Qwen3 plans tool use inside its reasoning scratchpad. Enable thinking (`enable_thinking: true`) — tool calling becomes reliable. |
| With thinking enabled, the model produced 16,103 chars of reasoning content and 0 chars of displayed content, hitting `finish_reason: length` with `max_tokens: 4096`. | Bump `max_tokens` to fit reasoning + content + tool-call JSON (we use 6144 inside an 8192 ctx). Tighten the prompt to give the model less to ruminate about. `thinking_budget: 1024` *may* help when the template honors it (Lemonade's didn't, but it's harmless to send). |
| Tool-call JSON arguments were truncated mid-string at the previous 900-token cap (e.g. an `update_story_summary.content` value with no closing quote), causing llama-server to throw a parse error wrapped in a 200 OK. | Raise `max_tokens` so multi-paragraph args fit. Also detect `data.error` in 200 responses and surface the real backend message instead of "returned no message". |
| Lemonade returns Qwen3 thinking in a **separate `reasoning_content` field**, not inline `<think>...</think>` tags in `content`. Stripping `<think>` from `content` did nothing because there was nothing there to strip. | Log both `contentChars` and `reasoningChars` so you can tell which field the model used; keep the `<think>` stripper as belt-and-suspenders for servers that do inline thinking. |
| The model would call `generate_image` repeatedly across iterations, never producing final prose, exhausting MAX_TOOL_ITERATIONS. | Once the required tools (image + tts + summary) have each been called at least once, force `tool_choice: 'none'` on the next iteration so the model is required to emit text and exit. |
| When the model produced prose **and** tool calls in iter 1 (the natural pattern this prompt requests), our loop captured only the no-tool-call iteration's content and discarded the iter-1 prose. | Capture content from *any* iteration; if a single iteration produces prose plus every required tool, early-return so iter 2 doesn't write a different scene over the top of what was just narrated. |

## Building a multi-media Tauri app

| Problem | Resolution |
| --- | --- |
| `<img src="asset://localhost/%2Fhome%2F…">` returned `onError` even with `assetProtocol.scope: ["**"]`. Hours of glob-debugging followed; the real cause was a **path bug** — `list_timeline` returned bare filenames like `"0001-scene.png"` but consumers joined them onto `story_dir` (not `story_dir/timeline`), so the URL pointed at a file that doesn't exist. | Always return *story-relative* paths from Rust (`"timeline/0001-scene.png"`). The asset protocol's "scope rejection" was actually a 404. |
| Tauri 2's `assetProtocol.scope` glob matching has subtle interactions with `require_literal_leading_dot` on Unix when paths cross `.cache`. Even with the path fixed, asset:// was a black box that ate time. | We bypassed `asset://` for media: a `read_artifact_b64` Tauri command returns base64 bytes and the renderer wraps them in `data:image/png;base64,…` / `data:audio/mpeg;base64,…` URLs. Same memory cost as asset:// since the bytes end up in the renderer either way, but failure modes are clear (an `invoke` error or a clean `onError` with the data-URL prefix). |
| `createNewStory` was clobbering `meta.thumbnail`: `write_thumbnail` updated meta.json with `thumbnail: "thumbnail.png"`, then the very next line called `updateMeta({ ...meta, title })` using the *stale* in-memory meta (with `thumbnail: null`) and overwrote the disk. | Reload meta from disk before any `updateMeta` that follows a sibling write. Defense in depth: `list_stories`/`load_story` now populate `meta.thumbnail` from disk if `thumbnail.png` exists, which also retroactively heals stories with clobbered meta. |
| When the agent loop's image step failed, the in-memory `imageB64`/`audioB64` were produced but `persistTurn` never ran, so the user saw "cover painted" in the UI yet there were no PNG/MP3 files on disk. | Drive UI step indicators from *post-persistence* events, not from in-flight tool results. Tools say "I started"; only the save path says "I'm on disk." |
| The 1:1 1024×1024 image filled the entire timeline card on default window size, pushing prose and audio off-screen. | Switched to 512×256 (2:1) — faster to generate and easier to lay out. Card uses a flex column with image pinned (`max-height: 45%`), prose scrolling (`overflow-y: auto; min-height: 0`), audio pinned at the bottom. |

## Agent-loop UX

| Problem | Resolution |
| --- | --- |
| TTS audio narrated text *X* while the timeline card displayed text *Y*. Iter 1 called `text_to_speech` with some "intended" prose; iter 2 produced the actually-displayed prose. | Track `ctx.audioSourceText` (the input the model passed to TTS). At every return point, compare with the final narration and re-narrate if they don't match. ~5 s overhead in the failure case, zero on the happy path. |
| The narration step indicator ("Writing the opening scene") spun, finished, then *spun again* during iter 2, confusing the user. | Two distinct steps: `planning` (iter 1, model is calling tools) and `composing` (iter 2 when `tool_choice` flips to `'none'`, model is writing the player-facing prose). Each spins once. |
| All bullets read "✓ done" while the agent was still working for ~28 s on iter 2's wrap-up. | Fire a new `composing` activity event the instant `tool_choice` becomes `'none'` so a fresh step lights up before the silent gap. |
| When the agent loop threw, `App.beginStory`'s catch only marked a step as "error" — the user was stranded on the `GeneratingScreen` forever. | Catch returns to `start`, surfaces the real error via toast, and `GeneratingScreen` now also has a "Back to start" button as an always-available escape. |
| The "Storyteller thinking…" status used animated `...` dots, which read as broken on a slow turn. | Replaced with a real CSS spinner (`.spinner`); kept the existing `.dot-loader` class around for places that still suit the typing-dots aesthetic. |

## Prompt engineering for an image-first RPG

| Problem | Resolution |
| --- | --- |
| The model wrote 1848 chars (≈300 words) of atmospheric prose every turn. | Hard word budget in the prompt ("60–120 words, 1–2 short paragraphs"). The image is told to carry the visuals; prose only adds what a picture can't show. |
| The model conflated "the story so far" wiki with the displayed prose. | Explicit two-audience framing: **displayed prose** = assistant message content, terse, read in seconds; **wiki** = `update_story_summary` content, 200–500 words, the model's private memory, never shown to the player. Tool descriptions echo this. |
| Prose ended with vague closers like *"What does he do next?"* that gave the player nothing to engage with. | "End with a concrete hook the player can act on right now — a person making a move, an object that begs investigation, a sound to chase, a clear fork. Show the situation that demands a choice; don't ask 'what do you do?'" |
| Third-person narration ("the detective pulls his coat tight") read as a story to *watch*, not a game to play. | Second-person, present-tense ("You pull your coat tight…"), with an anchoring example in the prompt. |
| Verbose multi-paragraph per-turn instructions blew up the model's reasoning. | Per-turn instructions trimmed to a single sentence; the system prompt is the durable contract, the per-turn message is just "open / advance." |
| The `update_story_summary` tool got called with `args = {}` once, which overwrote `story.md` with an empty string. | Tool dispatcher rejects empty content with a no-op result message that nudges the model to retry properly. |

## Debugging discipline

| Problem | Resolution |
| --- | --- |
| `console.log` in the renderer is invisible to anyone outside the devtools window — useless for an external observer. | Single shared log file at `~/.cache/halo-tales/halo-tales.log`. `makeLogger(scope)` in the renderer invokes a Rust `log_event` command so renderer logs land in the same file as `eprintln!`s from `lemonade.rs`/`story_fs.rs`. |
| Tauri's renderer hot-reload can hide stale state (e.g. `useEffect` running with a previous mount's closures). | Log a `TurnCard mount/update` line that includes the data the effect actually saw, so we can verify hot-reload picked the new code up. |
| Spent rounds guessing at Tauri scope behavior when the real bug was a path mismatch. | When a path-based protocol fails, check the actual file path first: does `ls "$path"` show the file? If no, fix the path; if yes, *then* debug the protocol. |
| Pre-emptive "safety net" backfill (synthesize image/audio if the model skipped) masked the real root cause (FLUX was actually broken). | Add diagnostics before reaching for backfills. Backfills are a last resort, not a first. |
