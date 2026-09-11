#!/usr/bin/env bash
# The version lives in three files. They must never drift.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg="$root/package.json"
cargo="$root/src-tauri/Cargo.toml"
conf="$root/src-tauri/tauri.conf.json"

json_version() { node -p "require('$1').version"; }
cargo_version() { sed -n '0,/^version = /s/^version = "\(.*\)"$/\1/p' "$cargo"; }

usage() {
  cat <<'USAGE'
Usage:
  scripts/bump.sh <version>   set the version in all three files
  scripts/bump.sh --check     exit non-zero if the three disagree
USAGE
}

check() {
  local p c t
  p="$(json_version "$pkg")"
  c="$(cargo_version)"
  t="$(json_version "$conf")"
  printf '  %-26s %s\n' "package.json" "$p" "src-tauri/Cargo.toml" "$c" "src-tauri/tauri.conf.json" "$t"
  if [ "$p" = "$c" ] && [ "$c" = "$t" ]; then
    echo "Versions agree: $p"
    return 0
  fi
  echo "Versions disagree. Run scripts/bump.sh <version> to line them up." >&2
  return 1
}

set_version() {
  local v="$1"
  if ! [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$v is not a version. Use three numbers, like 0.2.0." >&2
    exit 1
  fi
  sed -i "s/^\(  \"version\": \)\"[^\"]*\"/\1\"$v\"/" "$pkg"
  sed -i "s/^\(  \"version\": \)\"[^\"]*\"/\1\"$v\"/" "$conf"
  sed -i "0,/^version = /s/^version = \"[^\"]*\"/version = \"$v\"/" "$cargo"
  # Keep the lock file in step so a bump does not leave a dirty tree.
  sed -i "/^name = \"promptdeck\"$/{n;s/^version = \".*\"/version = \"$v\"/}" "$root/src-tauri/Cargo.lock"
  echo "Set version to $v in all three files:"
  check
}

case "${1-}" in
  --check) check ;;
  -h | --help | "") usage ;;
  *) set_version "$1" ;;
esac
