/**
 * Mesh Node
 * ─────────
 * Run:  node server.js [--port 8765] [--peers ws://neighbor-ip:8765]
 *
 * Each node:
 *   • Accepts browser clients and peer nodes on the same WebSocket port
 *   • Gossips its known peer list so the mesh self-assembles
 *   • Routes messages by flood-fill (TTL + seen-ID dedup) so multi-hop works
 *   • Auto-reconnects to lost peers every 10 seconds
 *   • Automatically opens port via UPnP (no router config needed)
 *
 * Bootstrap:
 *   First run with no --peers flag → standalone node, share your IP with a neighbor
 *   node server.js --peers ws://192.168.1.42:8765
 *   or list multiple:
 *   node server.js --peers ws://192.168.1.42:8765,ws://10.0.0.5:8765
 */

const http      = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const os        = require('os');
const crypto    = require('crypto');

// UPnP — optional, gracefully skipped if not available or router doesn't support it
let upnpClient = null;
try {
  const upnp = require('nat-upnp-2');
  upnpClient = upnp.createClient();
} catch(e) { /* nat-upnp-2 not installed — UPnP disabled */ }

// ── Config ────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const PORT       = parseInt(argVal(args, '--port') || '8765');
const SEED_PEERS = (argVal(args, '--peers') || '').split(',').filter(Boolean);
const NODE_ID    = crypto.randomBytes(6).toString('hex');
const MAX_TTL    = 12;
const RECONNECT_INTERVAL = 10000;
const GOSSIP_INTERVAL    = 15000;
const SEEN_TTL           = 30000;

function argVal(args, flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

// ── State ─────────────────────────────────────────────────────────────────────
const clients   = new Map(); // clientId -> { ws, name }
const peerConns = new Map(); // url -> { ws, alive }
const seenMsgs  = new Map(); // msgId -> expireAt

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/peers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ nodeId: NODE_ID, peers: [...peerConns.keys()], clients: clients.size }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Mesh node ${NODE_ID} — clients: ${clients.size}, peers: ${peerConns.size}\n`);
  }
});

const wss = new WebSocketServer({ server: httpServer });

// ── Utilities ─────────────────────────────────────────────────────────────────
function genId() { return crypto.randomBytes(8).toString('hex'); }

function seen(msgId) {
  if (seenMsgs.has(msgId)) return true;
  seenMsgs.set(msgId, Date.now() + SEEN_TTL);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, exp] of seenMsgs) if (now > exp) seenMsgs.delete(id);
}, 10000);

function myIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const ifaces of Object.values(nets))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return ips;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastClients(obj, excludeId) {
  for (const [id, c] of clients)
    if (id !== excludeId) send(c.ws, obj);
}

function forwardPeers(obj, excludeWs) {
  for (const p of peerConns.values())
    if (p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN)
      send(p.ws, obj);
}

// ── Gossip ────────────────────────────────────────────────────────────────────
function gossipPeerList() {
  const known = [...peerConns.keys()];
  const me = myIPs().map(ip => `ws://${ip}:${PORT}`);
  const msg = { type: 'peers', peers: [...new Set([...known, ...me])], nodeId: NODE_ID };
  for (const p of peerConns.values())
    if (p.ws.readyState === WebSocket.OPEN) send(p.ws, msg);
  broadcastClients({ type: 'topology', nodes: peerConns.size + 1, clients: clients.size }, null);
}
setInterval(gossipPeerList, GOSSIP_INTERVAL);

// ── Peer connections (outbound) ───────────────────────────────────────────────
function connectToPeer(url) {
  if (!url || peerConns.has(url)) return;
  const myUrls = myIPs().map(ip => `ws://${ip}:${PORT}`);
  if (myUrls.includes(url) || url.includes('localhost') && myUrls.length) return;

  console.log(`[peer] connecting → ${url}`);
  let ws;
  try { ws = new WebSocket(url); } catch(e) { return; }
  peerConns.set(url, { ws, alive: false });

  ws.on('open', () => {
    peerConns.get(url).alive = true;
    console.log(`[peer] connected  ✓ ${url}`);
    send(ws, { type: 'hello', nodeId: NODE_ID, port: PORT });
    gossipPeerList();
  });

  ws.on('message', raw => handlePeerMessage(raw, ws, url));

  ws.on('close', () => {
    console.log(`[peer] lost       ✗ ${url}`);
    peerConns.delete(url);
    broadcastClients({ type: 'topology', nodes: peerConns.size + 1, clients: clients.size }, null);
  });

  ws.on('error', err => {
    console.log(`[peer] error      ✗ ${url} — ${err.message}`);
    peerConns.delete(url);
  });
}

function handlePeerMessage(raw, ws, fromUrl) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'hello') {
    // acknowledged
  } else if (msg.type === 'peers') {
    for (const url of (msg.peers || [])) connectToPeer(url);
  } else if (msg.type === 'chat') {
    if (!msg.id || seen(msg.id)) return;
    if ((msg.ttl || 0) <= 0) return;
    msg.ttl--;
    broadcastClients(msg, null);
    forwardPeers(msg, ws);
  }
}

// Reconnect loop
setInterval(() => {
  for (const [url, p] of peerConns)
    if (p.ws.readyState === WebSocket.CLOSED || p.ws.readyState === WebSocket.CLOSING)
      peerConns.delete(url);
  for (const url of SEED_PEERS) connectToPeer(url);
}, RECONNECT_INTERVAL);

// ── Browser client connections (inbound) ──────────────────────────────────────
wss.on('connection', (ws, req) => {
  let clientId = null;
  let isPeer   = false;
  let peerUrl  = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Peer node handshake
    if (!clientId && !isPeer && msg.type === 'hello' && msg.nodeId) {
      isPeer  = true;
      peerUrl = `ws://${req.socket.remoteAddress}:${msg.port}`;
      if (!peerConns.has(peerUrl)) {
        peerConns.set(peerUrl, { ws, alive: true });
        console.log(`[peer] inbound    ✓ ${peerUrl}`);
        gossipPeerList();
        connectToPeer(peerUrl);
      }
      return;
    }

    if (isPeer) { handlePeerMessage(raw, ws, peerUrl); return; }

    // Browser client
    if (msg.type === 'join') {
      clientId = genId();
      clients.set(clientId, { ws, name: msg.name || 'anon' });
      console.log(`[client] +  ${msg.name} (${clientId.slice(0,6)})`);
      send(ws, { type: 'welcome', clientId, nodeId: NODE_ID, peerNodes: peerConns.size });
      broadcastClients({ type: 'sys', text: `${msg.name} joined` }, clientId);
      const topo = { type: 'topology', nodes: peerConns.size + 1, clients: clients.size };
      broadcastClients(topo, null);
      send(ws, topo);
    } else if (msg.type === 'chat' && clientId) {
      const out = {
        type: 'chat', id: genId(), ttl: MAX_TTL,
        from: clientId, name: clients.get(clientId)?.name || 'anon',
        text: msg.text, ts: Date.now()
      };
      seen(out.id);
      broadcastClients(out, clientId);
      forwardPeers(out, null);
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
    }
  });

  ws.on('close', () => {
    if (clientId) {
      const name = clients.get(clientId)?.name || 'someone';
      clients.delete(clientId);
      console.log(`[client] -  ${name}`);
      broadcastClients({ type: 'sys', text: `${name} left` }, null);
      broadcastClients({ type: 'topology', nodes: peerConns.size + 1, clients: clients.size }, null);
    }
    if (isPeer && peerUrl) peerConns.delete(peerUrl);
  });

  ws.on('error', err => console.warn('[ws]', err.message));
});

// ── UPnP port mapping ─────────────────────────────────────────────────────────
function setupUPnP() {
  if (!upnpClient) return;
  upnpClient.portMapping({
    public: PORT,
    private: PORT,
    ttl: 0,  // 0 = permanent until node stops
    description: 'Mesh Node'
  }, function(err) {
    if (err) {
      console.log(`  UPnP : not available (${err.message.slice(0,50)})`);
      console.log(`         Port forward ${PORT} manually in your router if needed.`);
      return;
    }
    console.log(`  UPnP : ✓ port ${PORT} opened automatically`);
    // Get public IP now that UPnP worked
    upnpClient.externalIp(function(err, ip) {
      if (!err && ip) {
        console.log(`\n  ┌─────────────────────────────────────────┐`);
        console.log(`  │  Share this with neighbors:              │`);
        console.log(`  │  ws://${ip}:${PORT}`.padEnd(44) + '│');
        console.log(`  └─────────────────────────────────────────┘\n`);
        // Tell connected browser clients the public address
        broadcastClients({ type: 'public-addr', addr: `ws://${ip}:${PORT}` }, null);
      }
    });
  });
}

// Clean up UPnP mapping on exit
function cleanupUPnP() {
  if (!upnpClient) return;
  upnpClient.portUnmapping({ public: PORT }, function() { upnpClient.close(); });
}
process.on('SIGINT',  () => { cleanupUPnP(); process.exit(0); });
process.on('SIGTERM', () => { cleanupUPnP(); process.exit(0); });

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = myIPs();
  console.log(`\n◈ Mesh node ${NODE_ID} started`);
  console.log(`  Port : ${PORT}`);
  if (ips.length) {
    console.log(`  LAN  : ${ips.map(ip => `ws://${ip}:${PORT}`).join(', ')}`);
  }
  if (SEED_PEERS.length) {
    console.log(`  Seeds: ${SEED_PEERS.join(', ')}`);
    SEED_PEERS.forEach(connectToPeer);
  } else {
    console.log(`\n  No seed peers — you are the first node.`);
  }
  // Try UPnP to get public address automatically
  console.log(`  UPnP : trying to open port ${PORT} on your router...`);
  setupUPnP();
  console.log('');
});
