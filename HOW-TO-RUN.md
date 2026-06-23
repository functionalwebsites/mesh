# Mesh — How to Run

## Quickstart

1. Push `index.html` and `manifest.json` to a GitHub repo
2. Enable GitHub Pages on the repo (Settings → Pages → Deploy from main branch)
3. Share the URL — anyone who opens it can join the mesh

That's it. No server to run. No accounts.

---

## How it works

Mesh uses **Trystero** (open source) which uses public **NOSTR relays** to
introduce peers to each other. After that brief handshake (~1 second), all
messages travel directly peer-to-peer via WebRTC — end-to-end encrypted,
not passing through any server at all.

```
Device A ──NOSTR relay──▶ Device B   (handshake only, ~1 sec)
Device A ◀──── WebRTC (encrypted P2P) ────▶ Device B   (all messages)
```

The NOSTR relay never sees message content — only enough to introduce peers.

---

## Using it

1. Open the page in any browser (Chrome, Safari, Firefox, Edge)
2. Enter your name and a **channel name** (any word or phrase)
3. Anyone else who opens the page and enters the **same channel name** will
   appear in your chat automatically

---

## Important: the offline scenario

Because NOSTR relays are public internet infrastructure, the initial peer
handshake requires internet access. Once two devices are connected via WebRTC,
you can disconnect from the internet and they stay connected over local WiFi
for the life of the browser tab.

**Sequence for offline-after-connect:**
1. Both devices open the page (internet on)
2. Both enter the same channel → they find each other via NOSTR
3. WebRTC P2P link is established
4. Turn off internet on one or both → chat continues over local WiFi

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app — self-contained |
| `manifest.json` | Makes it installable as a PWA |
| `server.js` | Legacy local signaling server (not needed for normal use) |

---

## GitHub Pages deployment

```bash
git init
git add index.html manifest.json .gitignore
git commit -m "init mesh"
git remote add origin https://github.com/YOUR_USERNAME/mesh.git
git push -u origin main
```

Then in GitHub repo Settings → Pages → Source: Deploy from branch `main`, folder `/`.
Your app will be live at `https://YOUR_USERNAME.github.io/mesh/`
