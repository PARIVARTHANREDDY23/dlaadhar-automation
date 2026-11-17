#!/bin/bash
set -e

# Start X Virtual Framebuffer on display :99 with 1366x768 resolution
echo "[Startup] Starting Xvfb virtual desktop screen on :99..."
Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

export DISPLAY=:99
sleep 1

echo "[Startup] Xvfb running with PID $XVFB_PID on DISPLAY=:99"

# Determine target port
PORT="${PORT:-8000}"

echo "[Startup] Launching FastAPI enterprise automation server on port $PORT..."
exec uvicorn server:app --host 0.0.0.0 --port "$PORT"
