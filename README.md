<h1 align="center">mac-clean</h1>

<p align="center">
  <img src="assets/mac-clean-demo.gif" alt="mac-clean demo" width="800">
</p>

<p align="center">
  <b>Your own, auditable macOS disk-cleanup tool with a local GUI.</b><br>
  Scan your Mac for wasted space, review it, and approve every deletion yourself.
</p>

<p align="center">
  <a href="#-safety-by-design">Safety</a> &middot;
  <a href="#-install">Install</a> &middot;
  <a href="#-usage">Usage</a> &middot;
  <a href="#-categories">Categories</a> &middot;
  <a href="#-how-it-works">How it works</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-000000?logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white" alt="Node 18+">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/runtime%20deps-0-2ea44f" alt="Zero runtime dependencies">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</p>

---

## Why

Most Mac cleaners are closed black boxes you have to *trust* with your whole disk.
**mac-clean is the opposite.** It has **zero runtime dependencies** — only Node.js
built-ins ever touch your filesystem — so you can read every line that runs. It never
deletes anything on its own: it scans, groups what it finds, and waits for **you** to
pick exactly what goes. The default action moves files to the Trash, so mistakes are
recoverable.

> Built as a self-hosted alternative to third-party cleaners — nothing leaves your machine, nothing runs without your click.

---

## 🛡️ Safety by design

<table>
<tr>
<td><b>👀 Read-only scanning</b></td>
<td>Scanning never deletes or modifies anything. It only measures sizes.</td>
</tr>
<tr>
<td><b>🗑️ Trash by default</b></td>
<td>Default action moves items to the macOS Trash via native <code>NSFileManager</code> — fully recoverable. Permanent delete is a separate, double-confirmed action.</td>
</tr>
<tr>
<td><b>✅ You approve everything</b></td>
<td>The server only ever acts on the exact paths you selected and confirmed in the GUI. Nothing is automatic.</td>
</tr>
<tr>
<td><b>🔒 Scan-gated deletion</b></td>
<td>It refuses to remove any path that didn't come from a scan result — the GUI cannot ask it to touch arbitrary files.</td>
</tr>
<tr>
<td><b>⛔ Protected areas</b></td>
<td><code>/System</code>, <code>/usr</code>, <code>/bin</code>, your home root, and more are hard-blocked, then re-checked on disk right before any deletion (TOCTOU-safe).</td>
</tr>
<tr>
<td><b>🧩 Zero runtime dependencies</b></td>
<td>Backend is pure Node.js built-ins (<code>http</code>, <code>fs</code>, <code>child_process</code>). The whole thing is small enough to audit yourself.</td>
</tr>
<tr>
<td><b>🏠 Local only</b></td>
<td>Binds to <code>127.0.0.1</code> with a per-session token. No telemetry, no network calls, nothing leaves your Mac.</td>
</tr>
</table>

---

## 📦 Install

Requires **Node.js 18+** and **macOS**.

```bash
git clone <your-repo> mac-clean && cd mac-clean
npm install
npm run build
npm link          # makes the `mac-clean` command available globally
```

> Prefer not to link? Just run `npm start`.

---

## 🚀 Usage

```bash
mac-clean              # starts the local server and opens the GUI in your browser
mac-clean --port 5000  # use a different port
mac-clean --no-open    # don't auto-open the browser; the URL is printed instead
```

mac-clean opens, scans your whole Mac in the background, and streams results in as
they're found. Then:

| | Step |
|:-:|------|
| 1 | **Storage overview** — see your disk, biggest home folders, and largest apps at a glance. |
| 2 | **Review** — categories are colour-coded by risk (🟢 safe · 🟡 moderate · 🔴 risky) and sorted by size. Click a category to expand its files. |
| 3 | **Select** — click any file row to tick it. Use **Reveal** to open it in Finder first. |
| 4 | **Approve** — *Move to Trash* (recoverable) or *Delete permanently…* (double-confirmed). |

---

## 🗂️ Categories

| Category | Risk | What it finds |
| --- | --- | --- |
| Trash | 🟢 safe | Items already in the macOS Trash |
| Temporary files | 🟢 safe | Leftovers in `/tmp` |
| Browser caches | 🟢 safe | Chrome / Safari / Firefox / Arc / Brave / Edge caches |
| Homebrew cache | 🟢 safe | Downloaded installers / old versions (`brew --cache`) |
| Docker* | 🟢 safe | Unused images, containers, build cache (`docker system df`) |
| Application caches | 🟡 moderate | Per-app caches in `~/Library/Caches` |
| Logs | 🟡 moderate | `~/Library/Logs` |
| Developer caches | 🟡 moderate | npm, Yarn, pnpm, pip, CocoaPods, Gradle, Cargo, Xcode |
| node_modules folders | 🟡 moderate | Dependency folders in your project directories |
| Orphaned launch agents | 🟡 moderate | `~/Library/LaunchAgents` entries pointing to missing programs |
| Old downloads | 🔴 risky | `~/Downloads` items untouched for N days |
| Large files | 🔴 risky | Big files in Downloads / Documents / Desktop |
| Large folders | 🔴 risky | Every folder over a size threshold (VMs, AI models, app data, projects) |
| Applications | 🔴 risky | Installed apps you can move to the Trash |
| iOS device backups | 🔴 risky | iPhone/iPad backups stored on this Mac |
| Mail attachments | 🔴 risky | Attachments cached by Mail.app |
| Duplicate files | 🔴 risky | Identical files (SHA-256), nothing pre-selected |

> \* **Docker** lives inside its own virtual disk, so it can't be trashed file-by-file.
> mac-clean reports what's reclaimable and gives you a **Copy** button for the
> `docker system prune -af` command to run yourself — it never runs it for you, and
> that one is **not** recoverable from the Trash.

---

## ⚙️ How it works

A tiny local HTTP server (pure Node) does the scanning and serves a plain
HTML/CSS/JS GUI you open in your browser. Sizes are computed with the system `du`
and `find` tools across parallel workers, so a full scan of every category finishes
in a few seconds.

```
src/
  cli.ts            entry point: start server, open browser
  server.ts         HTTP server, scan (SSE) + delete endpoints
  security.ts       protected-path rules and deletion validation
  trash.ts          move-to-Trash / permanent delete
  du.ts · fsfind.ts fast, read-only size + file discovery
  scanners/         one module per group of categories
public/             the GUI (plain HTML/CSS/JS)
scripts/            trash-items.js (native trashing via osascript)
```

```bash
npm run typecheck   # type-check without emitting
npm run build       # compile to dist/
```

### Full Disk Access

macOS protects some locations (parts of `~/Library`, the Trash, …). If a scan looks
incomplete, grant your terminal **Full Disk Access** in
*System Settings → Privacy & Security → Full Disk Access*. Moving items to the Trash
works without it.

---

## License

MIT — see [LICENSE](LICENSE)

<p align="center"><sub>Scan · review · you approve every deletion.</sub></p>
