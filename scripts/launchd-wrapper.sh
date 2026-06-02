#!/bin/bash
set -euo pipefail
export HOME="/Users/Hana"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"
exec node src/export-all-groups.js "$@"
