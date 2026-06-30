const TOKEN = window.MAC_CLEAN_TOKEN;
const $ = (sel) => document.querySelector(sel);

const state = {
  categories: [],
  results: new Map(),
  selected: new Map(),
  cards: new Map(),
  scanning: false,
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  const value = bytes / Math.pow(1000, i);
  const decimals = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "x-mac-clean-token": TOKEN, "content-type": "application/json", ...options.headers },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function cssEscape(s) {
  return s.replace(/["\\]/g, "\\$&");
}

/* ---------- Storage overview ---------- */

const homeFolders = new Map();

function loadOverview() {
  const source = new EventSource(`/api/overview?token=${TOKEN}`);
  source.addEventListener("disk", (e) => renderDisk(JSON.parse(e.data)));
  source.addEventListener("section", (e) => renderSection(JSON.parse(e.data)));
  source.addEventListener("folder", (e) => {
    const f = JSON.parse(e.data);
    homeFolders.set(f.path, f);
    renderHomeFolders();
  });
  source.addEventListener("done", () => source.close());
  source.onerror = () => source.close();
}

function renderDisk(disk) {
  const pct = disk.total ? (disk.used / disk.total) * 100 : 0;
  $("#disk-used").style.width = pct.toFixed(1) + "%";
  $("#disk-summary").textContent = `${formatBytes(disk.used)} used of ${formatBytes(disk.total)}`;
  $("#disk-legend").innerHTML = `
    <span><span class="swatch" style="background:#0071e3"></span>Used ${formatBytes(disk.used)}</span>
    <span><span class="swatch" style="background:#e9e9ed"></span>Available ${formatBytes(disk.free)}</span>`;
}

function bdItem(name, size, max) {
  return `
    <div class="bd-item">
      <div class="bd-row"><span class="bd-name">${escapeHtml(name)}</span>
        <span class="bd-size">${formatBytes(size)}</span></div>
      <div class="bd-track"><div class="bd-fill" style="width:${((size / max) * 100).toFixed(1)}%"></div></div>
    </div>`;
}

function renderHomeFolders() {
  let col = $("#bd-home");
  if (!col) {
    col = document.createElement("div");
    col.className = "breakdown-col";
    col.id = "bd-home";
    $("#breakdown").prepend(col);
  }
  const items = [...homeFolders.values()].sort((a, b) => b.size - a.size).slice(0, 12);
  const max = items.reduce((m, i) => Math.max(m, i.size), 1);
  col.innerHTML = `<h3>Biggest folders</h3>` + items.map((i) => bdItem(i.name, i.size, max)).join("");
}

function renderSection(section) {
  const existing = document.querySelector(`.breakdown-col[data-id="${section.id}"]`);
  const col = existing || document.createElement("div");
  col.className = "breakdown-col";
  col.dataset.id = section.id;
  const max = section.items.reduce((m, i) => Math.max(m, i.size), 1);
  const rows = section.items.map((i) => bdItem(i.name, i.size, max)).join("");
  col.innerHTML = `<h3>${escapeHtml(section.title)}</h3>${rows || '<span class="muted">—</span>'}`;
  if (!existing) $("#breakdown").appendChild(col);
}

/* ---------- Cleanup: cards + scan ---------- */

function renderCards() {
  const container = $("#results");
  container.innerHTML = "";
  state.cards.clear();
  for (const cat of state.categories) {
    const card = document.createElement("div");
    card.className = "cat-result scanning";
    card.dataset.id = cat.id;
    card.innerHTML = `
      <div class="cat-result-head">
        <input type="checkbox" class="cat-toggle" hidden />
        <span class="dot ${cat.group}"></span>
        <div class="grow">
          <div class="cat-title">${escapeHtml(cat.label)}</div>
          <div class="cat-sub muted">Scanning…</div>
        </div>
        <span class="size"><span class="spinner"></span></span>
        <span class="chevron">›</span>
      </div>
      <div class="cat-body"></div>`;

    const head = card.querySelector(".cat-result-head");
    head.addEventListener("click", (e) => {
      if (e.target.closest(".cat-toggle, .reveal, .run-btn")) return;
      if (card.classList.contains("has-body")) card.classList.toggle("open");
    });
    card.querySelector(".cat-toggle").addEventListener("change", (e) => {
      card.querySelectorAll(".item-check").forEach((cb) => {
        if (cb.checked !== e.target.checked) {
          cb.checked = e.target.checked;
          toggleSelection(cb);
        }
      });
    });

    container.appendChild(card);
    state.cards.set(cat.id, card);
  }
}

function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  $("#rescan-btn").classList.add("spinning");
  state.results.clear();
  state.selected.clear();
  updateActionBar();
  renderCards();

  const ids = state.categories.map((c) => c.id);
  const params = new URLSearchParams({
    token: TOKEN,
    categories: ids.join(","),
    minItemMB: $("#opt-min").value || "1",
    downloadsDaysOld: $("#opt-days").value || "30",
    largeFileMinMB: $("#opt-large").value || "200",
    largeFolderMinMB: $("#opt-folder").value || "300",
    duplicatesMinMB: $("#opt-dup").value || "5",
  });

  let done = 0;
  const total = ids.length;
  const source = new EventSource(`/api/scan?${params}`);

  source.addEventListener("progress", (e) => {
    $("#scan-status").textContent = JSON.parse(e.data).message;
  });
  source.addEventListener("category-done", (e) => {
    const result = JSON.parse(e.data);
    state.results.set(result.id, result);
    fillFileCard(result);
    done++;
    $("#scan-status").textContent = `Scanning… ${done}/${total}`;
    updateFound();
  });
  source.addEventListener("command-done", (e) => {
    const result = JSON.parse(e.data);
    result.kind = "command";
    state.results.set(result.id, result);
    fillCommandCard(result);
    done++;
    $("#scan-status").textContent = `Scanning… ${done}/${total}`;
    updateFound();
  });
  source.addEventListener("done", () => {
    source.close();
    state.scanning = false;
    $("#rescan-btn").classList.remove("spinning");
    $("#scan-status").textContent = `Scan complete · ${formatBytes(totalFound())} found across ${total} categories`;
    sortCards();
  });
  source.onerror = () => {
    source.close();
    state.scanning = false;
    $("#rescan-btn").classList.remove("spinning");
    $("#scan-status").textContent = "Scan stopped.";
  };
}

function fillFileCard(result) {
  const card = state.cards.get(result.id);
  if (!card) return;
  card.classList.remove("scanning");
  const sub = card.querySelector(".cat-sub");
  const size = card.querySelector(".size");
  const body = card.querySelector(".cat-body");
  const toggle = card.querySelector(".cat-toggle");
  const meta = state.categories.find((c) => c.id === result.id);

  if (result.error) {
    sub.textContent = "Couldn’t scan";
    size.textContent = "—";
    body.innerHTML = `<div class="empty">${escapeHtml(result.error)}</div>`;
    card.classList.add("has-body");
    return;
  }
  if (result.count === 0) {
    sub.textContent = "Nothing to clean";
    size.textContent = "0 B";
    card.classList.add("empty-cat");
    return;
  }

  sub.textContent = `${result.count} item${result.count === 1 ? "" : "s"}`;
  size.textContent = formatBytes(result.totalSize);
  toggle.hidden = false;
  body.innerHTML = "";
  if (meta?.warning) {
    const warn = document.createElement("div");
    warn.className = "cat-warning";
    warn.textContent = "⚠ " + meta.warning;
    body.appendChild(warn);
  }
  body.appendChild(renderItems(result.items));
  card.classList.add("has-body");
}

function fillCommandCard(result) {
  const card = state.cards.get(result.id);
  if (!card) return;
  card.classList.remove("scanning");
  const sub = card.querySelector(".cat-sub");
  const size = card.querySelector(".size");
  const body = card.querySelector(".cat-body");

  if (!result.available) {
    sub.textContent = result.reason || "Not available";
    size.textContent = "—";
    card.classList.add("empty-cat");
    return;
  }

  sub.textContent = "command-based";
  size.textContent = formatBytes(result.reclaimable);
  body.innerHTML = "";
  if (result.warning) {
    const warn = document.createElement("div");
    warn.className = "cat-warning";
    warn.textContent = "⚠ " + result.warning;
    body.appendChild(warn);
  }
  const run = document.createElement("div");
  run.className = "command-body";
  run.innerHTML = `
    <div class="command-detail">${escapeHtml(result.detail || "Nothing to reclaim.")}</div>
    <div class="command-copy">
      <code class="command-text">${escapeHtml(result.command)}</code>
      <button class="copy-btn">Copy</button>
    </div>
    <p class="command-hint">Run this in your terminal to reclaim the space.</p>`;
  run.querySelector(".copy-btn").addEventListener("click", (e) => copyCommand(result.command, e.target));
  body.appendChild(run);
  card.classList.add("has-body");
}

function renderItems(items) {
  const list = document.createElement("div");
  list.className = "items";
  const caption = document.createElement("div");
  caption.className = "items-caption";
  caption.textContent = `Files · ${items.length}`;
  list.appendChild(caption);
  let lastGroup = null;
  for (const item of items) {
    if (item.groupKey && item.groupKey !== lastGroup) {
      lastGroup = item.groupKey;
      const gl = document.createElement("div");
      gl.className = "group-label";
      gl.textContent = item.groupLabel || "Duplicate set";
      list.appendChild(gl);
    }
    list.appendChild(renderItem(item));
  }
  return list;
}

function renderItem(item) {
  const row = document.createElement("div");
  row.className = "item";
  const note = item.note ? `<span class="muted"> · ${escapeHtml(item.note)}</span>` : "";
  row.innerHTML = `
    <input type="checkbox" class="item-check" />
    <div class="grow">
      <div class="name">${escapeHtml(item.name)}${note}</div>
      <div class="path">${escapeHtml(item.path)}</div>
    </div>
    <span class="item-size">${formatBytes(item.size)}</span>
    <button class="reveal" title="Reveal in Finder">Reveal</button>`;

  const check = row.querySelector(".item-check");
  check.dataset.path = item.path;
  check.dataset.size = item.size;
  check.addEventListener("change", () => toggleSelection(check));

  row.addEventListener("click", (e) => {
    if (e.target.closest(".reveal") || e.target.classList.contains("item-check")) return;
    check.checked = !check.checked;
    toggleSelection(check);
  });
  row.querySelector(".reveal").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    api("/api/reveal", { method: "POST", body: JSON.stringify({ path: item.path }) });
  });
  return row;
}

function sortCards() {
  const container = $("#results");
  const cards = [...state.cards.values()].sort((a, b) => {
    const sa = state.results.get(a.dataset.id)?.totalSize ?? state.results.get(a.dataset.id)?.reclaimable ?? 0;
    const sb = state.results.get(b.dataset.id)?.totalSize ?? state.results.get(b.dataset.id)?.reclaimable ?? 0;
    return sb - sa;
  });
  cards.forEach((c) => container.appendChild(c));
}

/* ---------- selection + actions ---------- */

function toggleSelection(check) {
  if (check.checked) state.selected.set(check.dataset.path, Number(check.dataset.size));
  else state.selected.delete(check.dataset.path);
  check.closest(".item")?.classList.toggle("selected", check.checked);
  updateActionBar();
}

function updateActionBar() {
  const count = state.selected.size;
  const size = [...state.selected.values()].reduce((a, b) => a + b, 0);
  $("#selected-count").textContent = `${count} item${count === 1 ? "" : "s"}`;
  $("#selected-size").textContent = count ? formatBytes(size) : "";
  $("#action-bar").hidden = count === 0;
}

function totalFound() {
  return [...state.results.values()].reduce((a, r) => a + (r.totalSize ?? r.reclaimable ?? 0), 0);
}

function updateFound() {
  $("#found-value").textContent = formatBytes(totalFound());
}

async function copyCommand(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied!";
    showToast("Command copied — paste it into your terminal.");
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  } catch {
    showToast("Couldn’t copy automatically — select the command and copy it.");
  }
}

async function performDelete(mode) {
  const paths = [...state.selected.keys()];
  if (paths.length === 0) return;
  const size = formatBytes([...state.selected.values()].reduce((a, b) => a + b, 0));
  const verb = mode === "delete" ? "PERMANENTLY DELETE" : "move to Trash";
  if (!confirm(`${verb} ${paths.length} item(s) (${size})?`)) return;
  if (mode === "delete" && !confirm("This cannot be undone. Are you absolutely sure?")) return;

  $("#trash-btn").disabled = true;
  $("#delete-btn").disabled = true;
  try {
    const res = await api("/api/delete", { method: "POST", body: JSON.stringify({ paths, mode }) });
    const ok = res.results.filter((r) => r.ok);
    const failed = res.results.filter((r) => !r.ok);
    ok.forEach((r) => removeItemFromUI(r.path));
    if (failed.length) {
      console.warn("Failed:", failed);
      const reason = failed[0].error ? ` — ${failed[0].error}` : "";
      showToast(`${ok.length} removed, ${failed.length} failed${reason}`);
    } else {
      showToast(`${ok.length} moved to Trash.`);
    }
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    $("#trash-btn").disabled = false;
    $("#delete-btn").disabled = false;
  }
}

function removeItemFromUI(path) {
  state.selected.delete(path);
  const check = document.querySelector(`.item-check[data-path="${cssEscape(path)}"]`);
  check?.closest(".item")?.remove();
  updateActionBar();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 3500);
}

async function init() {
  loadOverview();
  const data = await api("/api/categories");
  state.categories = data.categories;
  startScan();

  $("#rescan-btn").addEventListener("click", startScan);
  $("#options-btn").addEventListener("click", () => {
    const panel = $("#options-panel");
    panel.hidden = !panel.hidden;
  });
  $("#apply-options").addEventListener("click", () => {
    $("#options-panel").hidden = true;
    startScan();
  });
  $("#trash-btn").addEventListener("click", () => performDelete("trash"));
  $("#delete-btn").addEventListener("click", () => performDelete("delete"));
}

init().catch((err) => showToast("Failed to start: " + err.message));
