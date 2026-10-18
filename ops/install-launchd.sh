#!/bin/bash
# Deploy a runtime copy and install (or reinstall) the launchd agents for this Mac user:
#   com.romevo.bot          Telegram bot, always running, restarted if it crashes
#   com.romevo.scrape-near  today + tomorrow, every 2 hours
#   com.romevo.scrape-full  next 14 days, every 6 hours
#
# Why a copy: macOS does not let background agents read ~/Documents (privacy protection),
# so launchd runs the code from ~/Library/Application Support/RomeVO. Re-run this script after
# changing code or config to redeploy. Remove everything with: ops/install-launchd.sh --uninstall
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$HOME/Library/Application Support/RomeVO"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/romevo"
LABELS=(com.romevo.bot com.romevo.scrape-near com.romevo.scrape-full)
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin:$PATH"

for label in "${LABELS[@]}"; do launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true; done
if [[ "${1:-}" == "--uninstall" ]]; then
  for label in "${LABELS[@]}"; do rm -f "$AGENTS/$label.plist"; done
  rm -rf "$RUNTIME"
  echo "Uninstalled (database and logs kept)."
  exit 0
fi

mkdir -p "$AGENTS" "$LOGS" "$RUNTIME"
rsync -a --delete --exclude node_modules --exclude .git --exclude .cache --exclude fixtures --exclude coverage "$SRC/" "$RUNTIME/"
chmod 600 "$RUNTIME/.env"
(cd "$RUNTIME" && pnpm install --frozen-lockfile --silent)

plist() { # label, schedule-xml, args...
  local label="$1" schedule="$2"; shift 2
  local args=""
  for a in "$RUNTIME/ops/run.sh" "$@"; do args+="<string>$a</string>"; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>WorkingDirectory</key><string>$RUNTIME</string>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
  $schedule
</dict></plist>
EOF
}

plist com.romevo.bot '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>' bot
plist com.romevo.scrape-near '<key>StartInterval</key><integer>7200</integer>' scrape:near
plist com.romevo.scrape-full '<key>StartInterval</key><integer>21600</integer>' scrape

for label in "${LABELS[@]}"; do launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"; done
echo "Deployed to: $RUNTIME"
echo "Logs: $LOGS"
launchctl list | grep romevo
