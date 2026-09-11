---
name: promptdeck-release
description: Use when cutting a PromptDeck version, tagging, publishing the GitHub release, or working out why a release or CI run came back red — including when asked to look at a failing workflow log.
---

# Releasing PromptDeck

## The version lives in three files

`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Never edit
them by hand. `scripts/bump.sh <version>` sets all three (and `Cargo.lock`);
`scripts/bump.sh --check` is what CI runs to prove they agree.

## Cutting a release

1. `scripts/verify.sh` — must be clean before anything else. If it is red here,
   it will be red in CI.
2. Write the `CHANGELOG.md` entry for the person using the app: what they can
   now do, not which functions moved.
3. `scripts/bump.sh <version>`
4. Commit as `Release v<version>`
5. `git tag v<version>` then `git push origin main --follow-tags`
6. `gh run watch` on the release workflow
7. `gh release view v<version>` — expect a `.deb` and an `.AppImage`
8. Download the AppImage, `chmod +x`, run it, open a real vault, copy a block
9. Only then `gh release edit v<version> --draft=false`

The release is drafted on purpose. Do not publish a build nobody has run.

If something is wrong after tagging, do not move the tag. Bump the patch
version and go again — a moved tag means two different builds share a name.

## When a run goes red

Read the log before changing anything. Say which of the three it is:

- **Versions out of sync.** `scripts/bump.sh --check` fails and prints the three
  values. Someone edited one file by hand. Run `bump.sh` and commit.
- **A missing apt dependency.** The failure is a `pkg-config` error naming a
  library such as `gdk-3.0` or `webkit2gtk-4.1`, from a `*-sys` crate. The
  workflow's apt list is short by one package. Add it there; do not vendor it.
- **A bad icon path.** The bundler fails with a missing file while packaging.
  `tauri.conf.json` lists an icon that is not in `src-tauri/icons/`. Either
  create it or stop listing it. This is the most common cause of a build that
  passes `cargo build` and still fails the release.

Anything else: quote the failing lines, name whether it is our code, the
workflow or the runner image, and fix the cause.

Never make a run green by disabling a check, adding `continue-on-error`,
downgrading an action, or relaxing `-D warnings`. A green run that proves
nothing is worse than a red one.
