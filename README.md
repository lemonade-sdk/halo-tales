# HaloTales

**A local-AI creative roleplaying experience.**

HaloTales hands you a storyteller that lives entirely on your machine. Describe a setting, a character, or a situation, and the AI weaves an evolving story — narrating beat by beat, illustrating each scene, voice-acting the dialogue, and remembering everything you build together. Then you take a turn, and it adapts.

Every word, image, and audio clip is generated locally by [Lemonade Omni Models](https://lemonade-server.ai/) — no cloud, no telemetry, no rate limits. HaloTales automatically picks the right one for your hardware (the larger `LMX-Omni-52B-Halo` on systems with ≥64 GB of GPU VRAM, the lighter `LMX-Omni-5.5B-Lite` on everything else).

---

## What you can do

- **Start any story.** Detective noir, deep-space rescue, slice-of-life café, anything you can describe in a sentence.
- **Take turns.** The storyteller sets a scene; you reply with what your character does next.
- **See and hear it.** Each beat is illustrated and narrated automatically.
- **Edit the canon.** Open the Wiki to read or rewrite the story summary, character sheets, or any past turn — the storyteller will honor your edits on the next turn.
- **Steer the ending.** The story ends when you win, lose, or simply call it done.

## Getting started

### 1. Install prerequisites

You'll need either:

- **Recommended:** the [Lemonade desktop app](https://lemonade-server.ai/download) running on your machine, **or**
- (Automatic) HaloTales will download a private embedded copy of Lemonade on first launch.

Hardware recommendation: a recent GPU with ≥16 GB VRAM (or a modern Apple Silicon machine) will make the storytelling feel responsive. Smaller machines still work — turns just take longer.

### 2. Install HaloTales

Download the installer for your platform from the [Releases page](https://github.com/lemonade-sdk/halo-tales/releases):

- **Windows:** `HaloTales_x.y.z_x64-setup.exe`
- **macOS:** `HaloTales_x.y.z_universal.dmg`
- **Linux:** `halo-tales_x.y.z_amd64.deb` or `.AppImage`

### 3. Launch and play

On first launch HaloTales walks through a one-time setup:

1. Finds (or downloads) Lemonade.
2. Downloads the four AI models it relies on (~40 GB total — go grab a coffee).
3. Drops you on the library screen, ready to begin your first story.

> **Where is everything stored?** All stories, audio, and images live under `~/.cache/halo-tales/`. Delete that folder to wipe everything; nothing is ever sent off your machine.

## Models used

| Role | Model |
|------|-------|
| Storyteller | `Qwen3.6-35B-A3B-MTP-GGUF` (Qwen 3.6 35B, tool-calling) |
| Illustrator | `Flux-2-Klein-4B` (Flux 2 Klein 4B) |
| Voice actor | `kokoro-v1` (Kokoro v1) |
| Listener | `Whisper-Large-v3-Turbo` (Whisper Large v3 Turbo) |

## For developers

See [`docs/developer-guide.md`](docs/developer-guide.md) for setup, the architecture overview, and the agent tool reference.

## License

Apache-2.0 — see [LICENSE](LICENSE).
