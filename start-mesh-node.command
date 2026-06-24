#!/bin/bash
# Mesh Node Launcher — double-click to start
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Node.js not found" message "Install Node.js from nodejs.org (download the LTS version), then double-click this file again."'
  open "https://nodejs.org"
  exit 1
fi

if [ ! -f server.js ]; then
  osascript -e 'display alert "server.js not found" message "Make sure start-mesh-node.command and server.js are in the same folder."'
  exit 1
fi

# Install dependencies if needed
if [ ! -d node_modules/ws ] || [ ! -d node_modules/nat-upnp-2 ]; then
  echo "Installing dependencies (one-time setup)..."
  npm install ws nat-upnp-2 --save 2>/dev/null || npm install ws nat-upnp-2
fi

echo ""
echo "◈ Starting Mesh Node..."
echo "  Keep this window open to stay on the mesh."
echo "  Close it to disconnect."
echo ""

node server.js "$@"
