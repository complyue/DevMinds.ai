#!/bin/zsh
set -euo pipefail

ROOT="/ws/AiWorks/DevMinds.ai"

is_port_busy() {
  local port="$1"
  lsof -i tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# 后端（5175）：若端口占用则跳过启动
if is_port_busy 5175; then
  echo "[dev-servers] Backend already running on 5175, skip starting."
else
  echo "[dev-servers] Starting backend on 5175..."
  cd "$ROOT/packages/backend"
  pnpm dev &
fi

# 稍等片刻，避免前端启动时代理还未就绪
sleep 2

# 前端（5173）：若端口占用则跳过启动
if is_port_busy 5173; then
  echo "[dev-servers] Frontend already running on 5173, skip starting."
else
  echo "[dev-servers] Starting frontend on 5173..."
  cd "$ROOT/packages/webapp"
  pnpm dev
fi
