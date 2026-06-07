import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Prompt Tabs + Translate — a notepad-style node that, like Prompt Tabs, keeps
// any number of named tabs in one box, but each tab holds TWO independently
// editable fields: the source text and its translation. Three buttons translate
// the current source into Japanese / English / Chinese via the backend route
// /promptpalette_f/translate (googletrans, no API key). The translated field is
// freely editable afterward.
//
// Outputs: the active tab's source text, its translated text, and its label.
//
// State lives in the hidden `tabs_data` widget as JSON:
//   { tabs: [{ name, source, translated }], active: index }
// The visible `text` / `translated` multiline widgets are the editors for the
// active tab. Everything (tab bar, translate buttons, section labels) is built
// as DOM widgets so it stays interactive in both the legacy and Vue renderers.

// Target languages for the three buttons. `code` is sent to the backend.
const TRANSLATE_TARGETS = [
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "en", label: "英語", flag: "🇬🇧" },
  { code: "zh-cn", label: "中国語", flag: "🇨🇳" },
];

function hideWidget(widget) {
  widget.computeSize = () => [0, -4];
  widget.type = "hidden";
  widget.hidden = true;
  if (widget.element) {
    widget.element.style.display = "none";
  }
}

app.registerExtension({
  name: "idfa.PromptTabsTranslate",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PromptTabsTranslate") {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      setupPromptTabsTranslate(this);
      return result;
    };

    // Re-sync after a saved workflow is loaded (widget values are restored
    // between onNodeCreated and onConfigure).
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      this._promptTabsTranslate?.reload();
      return result;
    };

    // Tear down per-node observers/listeners on removal so deleting a node — or
    // loading a new workflow, which removes EVERY node — doesn't leak the
    // ResizeObservers + two MutationObservers (one watches the node root subtree)
    // and the detached DOM they pin. Without this, repeated workflow reloads
    // accumulate observers and can eventually crash the tab.
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._promptTabsTranslate?.cleanup?.();
      } catch (e) {
        /* ignore */
      }
      return onRemoved?.apply(this, arguments);
    };
  },
});

function setupPromptTabsTranslate(node) {
  const sourceWidget = node.widgets?.find((w) => w.name === "text");
  const transWidget = node.widgets?.find((w) => w.name === "translated");
  const dataWidget = node.widgets?.find((w) => w.name === "tabs_data");
  if (!sourceWidget || !transWidget || !dataWidget || !node.addDOMWidget) {
    return; // missing pieces → node degrades to two plain text boxes
  }

  hideWidget(dataWidget);

  // store = { tabs: [{ name, source, translated }], active: index }
  let store = { tabs: [{ name: "Tab 1", source: "", translated: "" }], active: 0 };

  function persist() {
    dataWidget.value = JSON.stringify(store);
  }

  function saveEditorsIntoActive() {
    const tab = store.tabs[store.active];
    if (tab) {
      tab.source = sourceWidget.value ?? "";
      tab.translated = transWidget.value ?? "";
    }
    persist();
  }

  function loadActiveIntoEditors() {
    const tab = store.tabs[store.active];
    // Programmatic set: does not fire the editors' "input" listeners, so no
    // feedback loop with saveEditorsIntoActive.
    sourceWidget.value = tab ? tab.source : "";
    transWidget.value = tab ? tab.translated : "";
  }

  function normalize(parsed) {
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    const tabs = parsed.tabs.map((t, i) => ({
      name: typeof t?.name === "string" && t.name.length ? t.name : `Tab ${i + 1}`,
      // Accept legacy `text` as a source alias for forward-compat with plain
      // Prompt Tabs saves that someone pasted in.
      source: typeof t?.source === "string" ? t.source
        : (typeof t?.text === "string" ? t.text : ""),
      translated: typeof t?.translated === "string" ? t.translated : "",
    }));
    let active = parsed.active;
    if (typeof active !== "number" || active < 0 || active >= tabs.length) {
      active = 0;
    }
    return { tabs, active };
  }

  // ---- state transitions ---------------------------------------------------

  function switchTab(i) {
    if (i === store.active) {
      return;
    }
    saveEditorsIntoActive();
    store.active = i;
    loadActiveIntoEditors();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  function addTab() {
    saveEditorsIntoActive();
    store.tabs.push({ name: `Tab ${store.tabs.length + 1}`, source: "", translated: "" });
    store.active = store.tabs.length - 1;
    loadActiveIntoEditors();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  function deleteTab(i) {
    if (store.tabs.length <= 1) {
      return; // always keep at least one tab
    }
    const tab = store.tabs[i];
    const hasText =
      (tab?.source ?? "").trim().length > 0 || (tab?.translated ?? "").trim().length > 0;
    const message = hasText
      ? `Delete tab "${tab.name}"? Its text will be lost.`
      : `Delete tab "${tab.name}"?`;
    if (!window.confirm(message)) {
      return;
    }
    saveEditorsIntoActive();
    store.tabs.splice(i, 1);
    if (store.active > i) {
      store.active -= 1;
    } else if (store.active >= store.tabs.length) {
      store.active = store.tabs.length - 1;
    }
    loadActiveIntoEditors();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  // Move a tab one slot left (dir = -1) or right (dir = +1), swapping it with
  // its neighbor. The moved tab stays active and follows its new position.
  function moveTab(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= store.tabs.length) {
      return;
    }
    saveEditorsIntoActive();
    const tmp = store.tabs[i];
    store.tabs[i] = store.tabs[j];
    store.tabs[j] = tmp;
    if (store.active === i) {
      store.active = j;
    } else if (store.active === j) {
      store.active = i;
    }
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  function renameTab(i) {
    const current = store.tabs[i]?.name ?? "";
    const name = window.prompt("Tab name:", current);
    if (name != null) {
      store.tabs[i].name = name.trim() || current || `Tab ${i + 1}`;
      persist();
      render();
      node.setDirtyCanvas(true, true);
    }
  }

  function reload() {
    let parsed = null;
    try {
      if (dataWidget.value) {
        parsed = normalize(JSON.parse(dataWidget.value));
      }
    } catch (e) {
      parsed = null;
    }
    // Fresh node (or unreadable data): seed one tab from whatever is already in
    // the editors so nothing is lost.
    store = parsed || {
      tabs: [
        {
          name: "Tab 1",
          source: sourceWidget.value ?? "",
          translated: transWidget.value ?? "",
        },
      ],
      active: 0,
    };
    loadActiveIntoEditors();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  // Disconnect everything this setup attached. Called from onRemoved.
  function cleanup() {
    if (node._pptRowObserver) { try { node._pptRowObserver.disconnect(); } catch (e) {} }
    if (node._pptRootObserver) { try { node._pptRootObserver.disconnect(); } catch (e) {} }
    node._pptRowObserver = null;
    node._pptRootObserver = null;
    node._pptRowGrid = null;
    node._pptRootEl = null;
    (node._pptResizeObservers || []).forEach((ro) => {
      try { ro.disconnect(); } catch (e) {}
    });
    node._pptResizeObservers = [];
    const sa = findTextArea(sourceWidget);
    if (sa) { try { sa.removeEventListener("input", saveEditorsIntoActive); } catch (e) {} }
    const tta = findTextArea(transWidget);
    if (tta) { try { tta.removeEventListener("input", saveEditorsIntoActive); } catch (e) {} }
  }

  // ---- translation ---------------------------------------------------------

  let translating = false;

  async function translate(target) {
    if (translating) {
      return;
    }
    saveEditorsIntoActive();
    const src = sourceWidget.value ?? "";
    if (!src.trim()) {
      setStatus("原文が空です", true); // "Source is empty"
      return;
    }
    translating = true;
    setButtonsDisabled(true);
    setStatus("翻訳中…"); // "Translating…"
    try {
      const resp = await api.fetchApi("/promptpalette_f/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: src, target }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) {
        setStatus(`翻訳失敗: ${json.error || resp.status}`, true);
        return;
      }
      if (typeof json.translated === "string") {
        transWidget.value = json.translated;
        saveEditorsIntoActive();
        setStatus(""); // clear
        render();
        node.setDirtyCanvas(true, true);
      } else {
        setStatus("翻訳結果なし", true); // "No translation result"
      }
    } catch (e) {
      setStatus(`翻訳失敗: ${e?.message || e}`, true);
    } finally {
      translating = false;
      setButtonsDisabled(false);
    }
  }

  // Swap the source and translated text of the active tab. Useful when a
  // translation lands in the "wrong" direction, or to keep editing in the
  // other field.
  function swapSourceTranslated() {
    const src = sourceWidget.value ?? "";
    const trans = transWidget.value ?? "";
    // Programmatic set: does not fire the editors' "input" listeners.
    sourceWidget.value = trans;
    transWidget.value = src;
    saveEditorsIntoActive();
    setStatus(""); // clear any previous message
    render();
    node.setDirtyCanvas(true, true);
  }

  // ---- DOM: tab bar --------------------------------------------------------

  const bar = document.createElement("div");
  bar.style.width = "100%";
  const inner = document.createElement("div");
  Object.assign(inner.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    alignItems: "center",
    width: "100%",
    boxSizing: "border-box",
    padding: "2px 0",
    fontFamily: "Arial, sans-serif",
    fontSize: "12px",
  });
  bar.appendChild(inner);

  function makeTab(tab, i) {
    const active = i === store.active;
    const el = document.createElement("div");
    Object.assign(el.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 6px",
      borderRadius: "4px",
      cursor: "pointer",
      userSelect: "none",
      border: `1px solid ${active ? "#7a7a7a" : "#444"}`,
      background: active ? "#4a4a4a" : "#262626",
      color: active ? "#ffffff" : "#b0b0b0",
      maxWidth: "180px",
    });

    // Reorder arrows — only on the active tab, to keep the bar uncluttered.
    // Disabled (greyed) at the ends so the range is obvious.
    function makeMover(arrow, dir, title) {
      const m = document.createElement("span");
      m.textContent = arrow;
      const j = i + dir;
      const enabled = j >= 0 && j < store.tabs.length;
      Object.assign(m.style, {
        color: enabled ? "#dddddd" : "#666666",
        fontWeight: "bold",
        padding: "0 2px",
        cursor: enabled ? "pointer" : "default",
      });
      m.title = title;
      m.addEventListener("pointerdown", (e) => e.stopPropagation());
      m.addEventListener("click", (e) => {
        e.stopPropagation();
        if (enabled) {
          moveTab(i, dir);
        }
      });
      return m;
    }
    if (active && store.tabs.length > 1) {
      el.appendChild(makeMover("◀", -1, "Move tab left"));
    }

    const label = document.createElement("span");
    label.textContent = tab.name || `Tab ${i + 1}`;
    Object.assign(label.style, {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    label.addEventListener("pointerdown", (e) => e.stopPropagation());
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab(i);
    });
    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      renameTab(i);
    });
    el.appendChild(label);

    if (active && store.tabs.length > 1) {
      el.appendChild(makeMover("▶", 1, "Move tab right"));
    }

    if (store.tabs.length > 1) {
      const close = document.createElement("span");
      close.textContent = "×";
      Object.assign(close.style, {
        color: active ? "#dddddd" : "#888888",
        fontWeight: "bold",
        padding: "0 2px",
      });
      close.title = "Delete tab";
      close.addEventListener("pointerdown", (e) => e.stopPropagation());
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteTab(i);
      });
      el.appendChild(close);
    }
    return el;
  }

  function makePlus() {
    const el = document.createElement("div");
    el.textContent = "+";
    el.title = "Add tab";
    Object.assign(el.style, {
      padding: "2px 8px",
      borderRadius: "4px",
      cursor: "pointer",
      userSelect: "none",
      border: "1px solid #444",
      background: "#262626",
      color: "#90c090",
      fontWeight: "bold",
    });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      addTab();
    });
    return el;
  }

  function render() {
    inner.replaceChildren(...store.tabs.map((t, i) => makeTab(t, i)), makePlus());
    node.setDirtyCanvas(true, true);
    scheduleAdjustEditorHeights(node);
  }

  const tabWidget = node.addDOMWidget("prompt_tabs_bar", "prompt_tabs_bar", bar, {
    serialize: false,
    hideOnZoom: false,
  });
  // Cached via ResizeObserver instead of reading offsetHeight inside computeSize
  // (which LiteGraph calls many times per frame, forcing a reflow each time —
  // the "Forced reflow" / long-rAF console violations). See trackHeight.
  const tabH = trackHeight(node, inner, 24);
  tabWidget.computeSize = (width) => [width, tabH.h];

  // ---- DOM: translate buttons + status -------------------------------------

  const btnBar = document.createElement("div");
  btnBar.style.width = "100%";
  const btnInner = document.createElement("div");
  Object.assign(btnInner.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    alignItems: "center",
    width: "100%",
    boxSizing: "border-box",
    padding: "2px 0",
    fontFamily: "Arial, sans-serif",
    fontSize: "12px",
  });
  btnBar.appendChild(btnInner);

  // "Translate:" prefix label so the buttons can show just the language name.
  const translateLabel = document.createElement("span");
  translateLabel.textContent = "Translate:";
  Object.assign(translateLabel.style, {
    flex: "0 0 auto",
    fontSize: "12px",
    color: "#9aa0a6",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  });
  btnInner.appendChild(translateLabel);

  const buttons = [];
  for (const t of TRANSLATE_TARGETS) {
    const b = document.createElement("button");
    b.textContent = `${t.flag} ${t.label}`;
    Object.assign(b.style, {
      flex: "1 1 auto",
      padding: "3px 6px",
      borderRadius: "4px",
      cursor: "pointer",
      userSelect: "none",
      border: "1px solid #555",
      background: "#2d3a4a",
      color: "#cfe2ff",
      fontSize: "12px",
      whiteSpace: "nowrap",
    });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      translate(t.code);
    });
    btnInner.appendChild(b);
    buttons.push(b);
  }

  // Swap button — exchanges the source and translated fields.
  const swapBtn = document.createElement("button");
  swapBtn.textContent = "⇅ 入れ替え";
  swapBtn.title = "原文と訳文を入れ替える"; // "Swap source and translation"
  Object.assign(swapBtn.style, {
    flex: "0 0 auto",
    padding: "3px 6px",
    borderRadius: "4px",
    cursor: "pointer",
    userSelect: "none",
    border: "1px solid #555",
    background: "#3a2d4a",
    color: "#e2cfff",
    fontSize: "12px",
    whiteSpace: "nowrap",
  });
  swapBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  swapBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    swapSourceTranslated();
  });
  btnInner.appendChild(swapBtn);

  const statusEl = document.createElement("span");
  Object.assign(statusEl.style, {
    flex: "0 0 auto",
    fontSize: "11px",
    color: "#9aa0a6",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  btnInner.appendChild(statusEl);

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#e57373" : "#9aa0a6";
  }
  function setButtonsDisabled(disabled) {
    for (const b of [...buttons, swapBtn]) {
      b.disabled = disabled;
      b.style.opacity = disabled ? "0.5" : "1";
      b.style.cursor = disabled ? "default" : "pointer";
    }
  }

  const btnWidget = node.addDOMWidget("ppt_translate_btns", "ppt_translate_btns", btnBar, {
    serialize: false,
    hideOnZoom: false,
  });
  const btnH = trackHeight(node, btnInner, 24);
  btnWidget.computeSize = (width) => [width, btnH.h];

  // ---- DOM: section labels -------------------------------------------------

  function makeLabelWidget(name, text) {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      width: "100%",
      boxSizing: "border-box",
      padding: "1px 2px",
      fontFamily: "Arial, sans-serif",
      fontSize: "11px",
      fontWeight: "bold",
      color: "#9aa0a6",
    });
    const w = node.addDOMWidget(name, name, el, { serialize: false, hideOnZoom: false });
    w.computeSize = (width) => [width, 16];
    return w;
  }
  // "Source (original)" / "Translation (editable)"
  const srcLabel = makeLabelWidget("ppt_src_label", "原文 (source)");
  const transLabel = makeLabelWidget("ppt_trans_label", "翻訳 (translated)");

  // ---- widget ordering -----------------------------------------------------
  // tab bar → translate buttons → [原文] → source editor → [翻訳] → translated
  // editor → (hidden tabs_data and anything else).
  const arranged = [tabWidget, btnWidget, srcLabel, sourceWidget, transLabel, transWidget];
  const arrangedSet = new Set(arranged);
  const rest = node.widgets.filter((w) => !arrangedSet.has(w));
  node.widgets = [...arranged, ...rest];

  // ---- live sync -----------------------------------------------------------
  const srcArea = findTextArea(sourceWidget);
  if (srcArea) {
    srcArea.addEventListener("input", saveEditorsIntoActive);
  }
  const transArea = findTextArea(transWidget);
  if (transArea) {
    transArea.addEventListener("input", saveEditorsIntoActive);
  }

  // Belt-and-suspenders: also flush at serialize/queue time.
  dataWidget.serializeValue = () => {
    saveEditorsIntoActive();
    return dataWidget.value;
  };

  node._promptTabsTranslate = { reload, cleanup };
  reload();

  // Size the editors once the Vue-rendered DOM exists (mount can land a little
  // after setup).
  setTimeout(() => applyEditorRowSizing(node), 100);
  setTimeout(() => applyEditorRowSizing(node), 500);
}

function findTextArea(widget) {
  let el = widget.inputEl || widget.element;
  if (el && el.tagName !== "TEXTAREA") {
    el = el.querySelector?.("textarea") || null;
  }
  return el && el.tagName === "TEXTAREA" ? el : null;
}

// Cache an element's rendered height so a widget's computeSize can return it
// WITHOUT reading offsetHeight on every call. computeSize runs many times per
// frame during LiteGraph layout; a sync offsetHeight read there forces a layout
// reflow each time. A ResizeObserver fires AFTER layout, so reading the box size
// in its callback is cheap and batched. Returns `{ h }` — read `.h` in
// computeSize. Only redraws when the height actually changes (no feedback loop:
// computeSize returns the cached value, so it never resizes the element).
function trackHeight(node, el, initial) {
  const state = { h: initial };
  try {
    const ro = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].borderBoxSize && entries[0].borderBoxSize[0];
      const h = box ? box.blockSize : el.offsetHeight;
      if (h > 0 && h !== state.h) {
        state.h = h;
        node.setDirtyCanvas(true, true);
      }
    });
    ro.observe(el);
    // Registered so onRemoved/cleanup can disconnect it (otherwise the observer
    // keeps the node + detached element alive).
    node._pptResizeObservers = node._pptResizeObservers || [];
    node._pptResizeObservers.push(ro);
  } catch (e) {
    // ResizeObserver unavailable — fall back to a one-time read.
    state.h = el.offsetHeight || initial;
  }
  return state;
}

// Re-assert the editor row sizing on the next frame(s), after Vue has
// re-rendered the node's DOM in response to a state change.
function scheduleAdjustEditorHeights(node) {
  if (typeof requestAnimationFrame !== "function") {
    applyEditorRowSizing(node);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => applyEditorRowSizing(node)));
}

// Nodes 2.0 only. The Vue node body is a CSS grid whose default
// `align-content: stretch` stretches every `auto` row to fill the node's
// height. A node with a SINGLE multiline widget therefore stretches its sole
// editor nicely (e.g. Prompt Tabs), but our node has SIX widget rows (tab bar,
// translate buttons, two section labels, two editors) — so the spare height is
// split across all of them, inflating the chrome rows and leaving each editor
// stuck at ~4-6 lines no matter how tall the node is.
//
// Fix: pin the non-editor rows to `min-content` so they only stretch the editor
// rows. The editor rows stay `auto` (min = the textarea's `min-h-16`), so the
// node can still be shrunk back down — NOT an explicit pixel height, which would
// force the node's minimum height up and make it un-shrinkable.
//
// Classic mode has no `.lg-node` DOM, so every lookup misses and this is a
// harmless no-op there.
function applyEditorRowSizing(node) {
  const root = document.querySelector('.lg-node[data-node-id="' + node.id + '"]');
  if (!root) return;
  const grid = root.querySelector(".lg-node-widgets");
  if (!grid) return;

  const children = [...grid.children];
  if (!children.some((c) => c.querySelector("textarea"))) return; // not mounted yet

  const desired = children
    .map((c) => (c.querySelector("textarea") ? "auto" : "min-content"))
    .join(" ");
  if (grid.style.gridTemplateRows !== desired) {
    grid.style.gridTemplateRows = desired;
  }

  // ComfyUI rewrites the grid's inline `grid-template-rows` on every layout
  // pass; re-assert ours whenever it does. Setting our own value re-fires the
  // observer, but then `desired` already matches and we skip — so no loop.
  if (node._pptRowGrid !== grid && typeof MutationObserver !== "undefined") {
    if (node._pptRowObserver) node._pptRowObserver.disconnect();
    node._pptRowObserver = new MutationObserver(() => applyEditorRowSizing(node));
    node._pptRowObserver.observe(grid, { attributes: true, attributeFilter: ["style"] });
    node._pptRowGrid = grid;
  }

  // The Vue renderer sometimes REPLACES the whole `.lg-node-widgets` grid on a
  // remount (e.g. after a heavy reflow). The style observer above is then
  // stranded on the detached old grid and never fires again, so our row sizing
  // is never re-applied to the fresh grid and the editors revert to ComfyUI's
  // default layout (the "height adjustment stopped working" state). Watch the
  // node root for structural changes so a grid swap re-triggers us on the new
  // grid. `childList` (no attributes) fires only on DOM add/remove, not on style
  // churn or typing, and setting `gridTemplateRows` above adds no nodes — so no
  // loop. The root element is keyed by node id and far more stable than the grid.
  if (node._pptRootEl !== root && typeof MutationObserver !== "undefined") {
    if (node._pptRootObserver) node._pptRootObserver.disconnect();
    node._pptRootObserver = new MutationObserver(() => scheduleAdjustEditorHeights(node));
    node._pptRootObserver.observe(root, { childList: true, subtree: true });
    node._pptRootEl = root;
  }
}
