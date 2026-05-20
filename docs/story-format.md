# Story format

Stories live under `~/.cache/halo-tales/stories/<story-id>/`. The on-disk layout is deliberately human-readable so users can browse, edit, back up, or version-control their stories with normal tools.

## Layout

```
~/.cache/halo-tales/
├── embedded-lemonade/          # only present if HaloTales had to download a private copy
│   ├── lemond[.exe]
│   ├── config.json
│   ├── bin/                    # backend binaries
│   ├── models/                 # GGUFs etc.
│   └── resources/
└── stories/
    └── <uuid>/
        ├── meta.json
        ├── story.md
        ├── thumbnail.png       # optional, set after the opening turn
        ├── characters/
        │   ├── alice.md
        │   └── the_storyteller.md
        └── timeline/
            ├── 0001-scene.md
            ├── 0001-scene.png
            ├── 0001-scene.mp3
            ├── 0002-user.md
            ├── 0003-scene.md
            └── …
```

## File contents

### `meta.json`

```json
{
  "id": "f7b3...-...",
  "title": "The Cartographer of Drowned Maps",
  "seed_prompt": "A cartographer arrives at a lighthouse that …",
  "created_at": "1742927481",
  "updated_at": "1742928912",
  "status": "active",        // or "ended"
  "thumbnail": "thumbnail.png", // or null
  "outcome": null              // "win" | "loss" | "complete" once ended
}
```

`created_at` / `updated_at` are Unix timestamps as strings (so JSON parsers don't mangle them).

### `story.md`

The agent-maintained running synopsis. Free-form markdown. The agent overwrites it (`update_story_summary`) whenever something meaningful changes; you can edit it manually in the Wiki and the agent will read the updated version on the next turn.

### `characters/<slug>.md`

One file per character. The agent uses these as long-term memory. Names are sanitized to `[A-Za-z0-9_-]` — a character called `Dr. Vance` becomes `characters/DrVance.md`.

Recommended format (the agent will produce something similar):

```markdown
---
role: antagonist
allegiance: The Black Carriage
status: alive
---

# Dr. Vance

A weather-bitten field surgeon who…
```

The frontmatter is optional and not parsed by HaloTales today — it exists for the model and for human readers.

### `timeline/NNNN-{scene,user}.{md,png,mp3}`

Every turn is a triple of files sharing the same 4-digit sequence prefix:

- `.md` — the prose for that turn (always present; required)
- `.png` — the scene illustration (optional; only present when the agent called `generate_image`/`edit_image`, or only on the user side if you ever add image uploads)
- `.mp3` — the narration audio (optional; only present for scenes the agent narrated)

The `{scene,user}` segment is the *role* of the turn: `scene` for agent turns, `user` for player turns. Anything else (e.g. `system`) is reserved for future use.

Numbering is monotonic and dense — gaps can appear if you delete a turn through the Wiki, and the next turn will pick up at `max + 1`, not fill the gap.

### `thumbnail.png`

Optional cover image for the story, set automatically the first time the agent generates a scene illustration. The path is recorded in `meta.json.thumbnail`.

## Editing by hand

You can open this directory in any editor — VS Code, Obsidian, plain `vim`. HaloTales does not lock the files. The next time you take a turn, the agent will read whatever's there.

If you delete the entire directory while the app is closed, the story is gone. If you delete just `meta.json`, HaloTales will hide the story (it scans for `meta.json` to find stories) but the files are still on disk for recovery.

## Wiping everything

To reset HaloTales completely:

```bash
rm -rf ~/.cache/halo-tales
```

This deletes stories AND the embedded Lemonade install. If you only want to start over with stories, delete `~/.cache/halo-tales/stories/`.
