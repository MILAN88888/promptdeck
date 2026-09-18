#!/usr/bin/env bash
# Exactly what CI runs, in the same order.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# So the script works in a shell that has not sourced the cargo profile.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "Frontend syntax"
node --check src/app.js
echo "src/app.js parses"

step "Markdown round trip"
node scripts/roundtrip.js

step "Rust formatting"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
echo "formatting is clean"

step "Clippy"
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

step "Rust tests"
cargo test --manifest-path src-tauri/Cargo.toml

step "Versions in step"
scripts/bump.sh --check

step "Release build"
npm run build

step "Bundles"
find src-tauri/target/release/bundle -type f \( -name '*.deb' -o -name '*.AppImage' \) \
  -printf '  %p  (%s bytes)\n' | sort
