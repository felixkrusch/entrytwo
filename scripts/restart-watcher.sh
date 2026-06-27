#!/bin/bash

# Update Restart Watcher for entrytwo
# This script monitors for the .restart file and triggers application restart
# Designed to run as a background process alongside the Next.js server

APP_DIR="/app/entrytwo"
RESTART_FILE="$APP_DIR/.restart"
LOG_FILE="$APP_DIR/logs/restart-watcher.log"

mkdir -p "$APP_DIR/logs"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

restart_app() {
  log "Restart signal detected - triggering application restart"
  
  # Try PM2 first
  if command -v pm2 &> /dev/null; then
    pm2 restart entrytwo 2>/dev/null && log "Restarted via PM2"
    return
  fi
  
  # Try systemd
  if command -v systemctl &> /dev/null; then
    systemctl restart entrytwo 2>/dev/null && log "Restarted via systemd"
    return
  fi
  
  # Fallback: kill and let process manager restart
  pkill -f "next-server" 2>/dev/null
  log "Sent kill signal (manual restart required)"
}

log "Starting restart watcher"

while true; do
  if [ -f "$RESTART_FILE" ]; then
    RESTART_TIME=$(cat "$RESTART_FILE" 2>/dev/null)
    CURRENT_TIME=$(date +%s)
    AGE=$((CURRENT_TIME - RESTART_TIME / 1000))
    
    # Only process if file is less than 5 minutes old (avoid stale signals)
    if [ $AGE -lt 300 ]; then
      rm -f "$RESTART_FILE"
      restart_app
    else
      log "Stale restart file detected, removing"
      rm -f "$RESTART_FILE"
    fi
  fi
  
  sleep 5
done