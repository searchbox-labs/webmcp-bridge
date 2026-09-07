#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
demo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$demo_dir/.." && pwd)
bundle_path="$demo_dir/webmcp-bridge-demoapp.tar.gz"

cd "$repo_dir"
npm run build

cd "$demo_dir"
npm run typecheck
npm run build

tar -C "$demo_dir/out" -czf "$bundle_path" .

printf 'VM bundle created: %s\n' "$bundle_path"
