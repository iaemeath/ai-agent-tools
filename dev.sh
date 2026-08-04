#!/usr/bin/env bash
# Dev launcher for ccc-ui (Tauri + SvelteKit).
set -euo pipefail

# Resolve the project root from this script's own location so the script works
# regardless of where it's invoked from (and survives repo renames).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# WSLg / Linux WebKit workarounds. These DISABLE hardware compositing, which
# fixes a blank window on machines without working GPU drivers — but it also
# forces every scroll into a CPU repaint, which is the #1 cause of janky
# scrolling. They are therefore OFF by default. Only enable them if you hit the
# blank-window problem:
#   CCC_UI_SOFTWARE_RENDER=1 ./dev.sh
if [ "${CCC_UI_SOFTWARE_RENDER:-0}" = "1" ]; then
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  echo "(software-render mode on: WebKit compositing disabled — scrolling may be slower)"
fi

# On a fresh clone (or after wiping .svelte-kit), SvelteKit's generated files
# (e.g. generated/server/internal.js) may be missing — Vite SSR then fails to
# load a module on the first request. Sync first so the generated tree is ready
# before the dev server starts answering requests.
if [ ! -d .svelte-kit/generated ]; then
  echo ".svelte-kit/generated missing — running 'svelte-kit sync'..."
  npx svelte-kit sync
fi

# Require a one-time frontend build so Tauri's compile-time frontendDist check
# (../build) passes on a fresh clone. `tauri dev` rebuilds the frontend itself
# via beforeDevCommand, but the crate must still compile first.
if [ ! -d build ]; then
  echo "build/ missing — running one-time 'npm run build'..."
  npm run build
fi

nohup npm run tauri dev > /tmp/cccui-dev.log 2>&1 &
echo "tauri dev started, pid=$!  (log: /tmp/cccui-dev.log)"
