#!/bin/bash
set -euo pipefail
export HOME="/Users/Hana"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

REPO_DIR="$HOME/Agents/nana/repos/line-desktop-mcp"
MERGE_SCRIPT="$HOME/Agents/.claude/skills/mojo-line-export/run-all-backups.command"

cd "$REPO_DIR"
node src/export-all-groups.js
bash "$MERGE_SCRIPT"
