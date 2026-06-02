#!/bin/bash
set -euo pipefail
export HOME="/Users/Hana"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export OPENCLAW_STATE_DIR="$HOME/Agents/openclaw"

RESULT_FILE="$HOME/Agents/mojo/data/line-exports/_runs/backup_result.txt"
SECRETS="$HOME/.secrets/shared/integrations.env"
TODAY=$(date +%Y-%m-%d)
LOG_PREFIX="[line-backup-healthcheck]"

CRON_IDS=(
  "287b2980-760b-4710-8020-c382798775a3"
  "a0ce828e-f701-444a-9e95-aea9cb02cbf1"
  "05a5d900-5712-4618-9af3-277c7fa768a4"
)

echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') Starting..."

PASS=false
SUCCESS_COUNT="?"
HAS_MOJO="?"

if [ ! -f "$RESULT_FILE" ]; then
  echo "$LOG_PREFIX FAIL: result file not found"
else
  RESULT_DATE=$(grep 'TIMESTAMP=' "$RESULT_FILE" | cut -d= -f2 | cut -c1-10)
  if [ "$RESULT_DATE" != "$TODAY" ]; then
    echo "$LOG_PREFIX FAIL: result from $RESULT_DATE, not today ($TODAY)"
  else
    SUCCESS_COUNT=$(grep 'SUCCESS_COUNT=' "$RESULT_FILE" | cut -d= -f2)
    if grep -q 'OK|.*mojo 猛健樂交流群' "$RESULT_FILE"; then
      HAS_MOJO="yes"
    else
      HAS_MOJO="no"
    fi

    if [ "$SUCCESS_COUNT" -ge 10 ] && [ "$HAS_MOJO" = "yes" ]; then
      PASS=true
    fi
    echo "$LOG_PREFIX SUCCESS_COUNT=$SUCCESS_COUNT, mojo=$HAS_MOJO, PASS=$PASS"
  fi
fi

if $PASS; then
  for id in "${CRON_IDS[@]}"; do
    openclaw cron enable "$id" 2>/dev/null || true
  done
  echo "$LOG_PREFIX LINE analysis cron ENABLED"
else
  for id in "${CRON_IDS[@]}"; do
    openclaw cron disable "$id" 2>/dev/null || true
  done
  echo "$LOG_PREFIX LINE analysis cron DISABLED"

  WEBHOOK_URL=""
  [ -f "$SECRETS" ] && WEBHOOK_URL=$(grep 'LINE_BACKUP_DISCORD_WEBHOOK=' "$SECRETS" | cut -d= -f2-)
  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -H "Content-Type: application/json" \
      -d "{\"content\":\"⚠️ **LINE 備份健康檢查失敗** ($(date '+%m/%d %H:%M'))\\n成功群組: ${SUCCESS_COUNT}（需 ≥10）\\nmojo 主群: ${HAS_MOJO}\\n\\n23:10/23:20/23:40 LINE 摘要已暫停，明天備份成功後自動恢復。\"}" \
      "$WEBHOOK_URL" > /dev/null
    echo "$LOG_PREFIX Discord notification sent"
  else
    echo "$LOG_PREFIX WARNING: no webhook URL, skipping notification"
  fi
fi

echo "$LOG_PREFIX Done."
