#!/usr/bin/env bash
cd /home/iaemeath/code/claude-tool-manager
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
nohup npm run tauri dev > /tmp/ctm-dev.log 2>&1 &
echo "tauri dev started, pid=$!"
