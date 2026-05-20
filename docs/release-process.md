# Release process

HaloTales ships via GitHub Releases, with all four platform installers built automatically by [`.github/workflows/release.yml`](../.github/workflows/release.yml). Cutting a release is one tag push.

## TL;DR

```bash
# Make sure everything is committed and CI is green on main
git checkout main && git pull

# Bump the version in package.json and src-tauri/Cargo.toml
# (Tauri reads productName/version from tauri.conf.json's "../package.json" pointer)
$EDITOR package.json src-tauri/Cargo.toml

git commit -am "v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Pushing a tag matching `v*` fires the release workflow. When it finishes (~25–40 min), a *draft* release named "HaloTales v0.2.0" appears with the platform installers attached. Review it, fill in the changelog, and click "Publish release".

## What gets built

| Platform | Runner | Bundles produced |
|---|---|---|
| Linux x86_64 | `ubuntu-latest` | `.deb`, `.rpm`, `.AppImage` |
| Windows x86_64 | `windows-latest` | `.msi`, `.exe` (NSIS) |
| macOS arm64 (Apple Silicon) | `macos-14` | `.dmg`, `.app` |
| macOS x86_64 (Intel) | `macos-13` | `.dmg`, `.app` |

Bundle targets are configured in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) under `bundle.targets`.

## Versioning

`tauri.conf.json` points at `package.json`'s `version`, so updating `package.json` is enough for the Tauri side. Bump `src-tauri/Cargo.toml`'s `version` to match (it's the version baked into the binary's metadata).

We use **semver-ish** without strict semantic guarantees while we're pre-1.0:

- `0.x.y` — `x` bumps for user-visible changes; `y` for fixes/internals.
- `1.0.0` — first release we'd recommend to a non-technical user.

## Pre-release

To test a build locally before tagging:

```bash
npm ci
npm run build       # = `tauri build`
ls src-tauri/target/release/bundle/
```

That builds for your current OS only. The CI workflow's `Build` job (in `ci.yml`) also runs `cargo check` on all three platforms on every PR to catch breakage early.

## Code signing

Today's releases are **unsigned** — users will see the standard "unidentified developer" warning on macOS and SmartScreen prompt on Windows. To add signing:

- **macOS:** set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` repository secrets; tauri-action picks them up automatically. Add `"signingIdentity": null` (replace with real) to `tauri.conf.json`'s `bundle.macOS`.
- **Windows:** set `WINDOWS_CERTIFICATE` (base64-encoded PFX) and `WINDOWS_CERTIFICATE_PASSWORD` secrets, and configure `windows.certificateThumbprint` in `tauri.conf.json`.

## Updater

We don't ship an auto-updater yet. If we add one, it goes in a `bundle.updater` block in `tauri.conf.json` plus a `latest.json` published next to the binaries on each release.

## Rollback

If a release is broken, just delete the GitHub release (the tag stays). To re-cut, bump the version (`v0.2.0` → `v0.2.1`) — the same tag cannot be re-pushed without force, which the CI explicitly disallows.
