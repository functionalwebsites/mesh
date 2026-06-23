/**
 * Mesh Network - Local Signaling Server
 * Run: node server.js
 * Then open index.html on any device on the same WiFi.
 * No internet needed once this is running.
 */

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = 8765;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Mesh signaling server running.\n");
});

const wss = new WebSocketServer({ server });

// Track all connected peers: id -> ws
const peers = new Map();

function broadcast(from, data) {
  for (const [id, ws] of peers) {
    if (id !== from && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2, 10);
  peers.set(id, ws);

  console.log(`[+] Peer connected: ${id} (total: ${peers.size})`);

  // Tell the new peer their ID
  ws.send(JSON.stringify({ type: "welcome", id, peerCount: peers.size - 1 }));

  // Tell everyone else a new peer arrived
  broadcast(id, { type: "peer-joined", id });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Route to specific peer or broadcast
    if (msg.to) {
      const target = peers.get(msg.to);
      if (target && target.readyState === 1) {
        target.send(JSON.stringify({ ...msg, from: id }));
      }
    } else {
      broadcast(id, { ...msg, from: id });
    }
  });

  ws.on("close", () => {
    peers.delete(id);
    console.log(`[-] Peer disconnected: ${id} (total: ${peers.size})`);
    broadcast(id, { type: "peer-left", id });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  // Print all local IPs so you know what to give your phone
  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();
  console.log(`\n✓ Mesh signaling server running on port ${PORT}`);
  console.log(`\nOpen on this machine:  http://localhost:${PORT}`);
  console.log(`\nOn your phone/other devices, use one of these IPs:`);
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log(`  ws://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`\nKeep this running. Open index.html in your browser.\n`);
});
