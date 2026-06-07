import { app } from "../../scripts/app.js";

// Prompt Tabs — a notepad-style node that keeps any number of named prompt
// tabs in one box. Click a tab to switch, double-click to rename, the small
// "x" to delete (with confirmation), and "+" to add a new tab. The active
// tab's text is what the node outputs; all tabs are stored in the hidden
// `tabs_data` widget as JSON.
//
// The tab bar is a DOM widget (real HTML), not a canvas-drawn widget, so it
// stays interactive in the new ComfyUI frontend ("Nodes 2.0" / Vue renderer)
// and wraps onto multiple rows via CSS flex-wrap.

const DBL_CLICK_MS = 350;

function hideWidget(widget) {
  // Keep the widget (so its value still serializes) but stop it from taking
  // layout space or drawing in either the legacy or the Vue frontend.
  widget.computeSize = () => [0, -4];
  widget.type = "hidden";
  widget.hidden = true;
  if (widget.element) {
    widget.element.style.display = "none";
  }
}

app.registerExtension({
  name: "idfa.PromptTabs",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PromptTabs") {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      setupPromptTabs(this);
      return result;
    };

    // Re-sync after a saved workflow is loaded (widget values are restored
    // between onNodeCreated and onConfigure).
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      this._promptTabs?.reload();
      return result;
    };

    // Tear down per-node observers/listeners on removal so deleting a node — or
    // loading a new workflow, which removes EVERY node — doesn't leak the
    // ResizeObserver + two MutationObservers (one watches the node root subtree)
    // and the detached DOM they pin. Without this, repeated workflow reloads
    // accumulate observers and can eventually crash the tab.
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        this._promptTabs?.cleanup?.();
      } catch (e) {
        /* ignore */
      }
      return onRemoved?.apply(this, arguments);
    };
  },
});

function setupPromptTabs(node) {
  const textWidget = node.widgets?.find((w) => w.name === "text");
  const dataWidget = node.widgets?.find((w) => w.name === "tabs_data");
  if (!textWidget || !dataWidget || !node.addDOMWidget) {
    return; // missing pieces → node degrades to a plain text box
  }

  hideWidget(dataWidget);

  // store = { tabs: [{ name, text }], active: index }
  let store = { tabs: [{ name: "Tab 1", text: "" }], active: 0 };

  function persist() {
    dataWidget.value = JSON.stringify(store);
  }

  function saveEditorIntoActive() {
    const tab = store.tabs[store.active];
    if (tab) {
      tab.text = textWidget.value ?? "";
    }
    persist();
  }

  function loadActiveIntoEditor() {
    const tab = store.tabs[store.active];
    // Programmatic set: does not fire the editor's "input" listener, so no
    // feedback loop with saveEditorIntoActive.
    textWidget.value = tab ? tab.text : "";
  }

  function normalize(parsed) {
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    const tabs = parsed.tabs.map((t, i) => ({
      name: typeof t?.name === "string" && t.name.length ? t.name : `Tab ${i + 1}`,
      text: typeof t?.text === "string" ? t.text : "",
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
    saveEditorIntoActive();
    store.active = i;
    loadActiveIntoEditor();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  function addTab() {
    saveEditorIntoActive();
    store.tabs.push({ name: `Tab ${store.tabs.length + 1}`, text: "" });
    store.active = store.tabs.length - 1;
    loadActiveIntoEditor();
    persist();
    render();
    node.setDirtyCanvas(true, true);
  }

  function deleteTab(i) {
    if (store.tabs.length <= 1) {
      return; // always keep at least one tab
    }
    const tab = store.tabs[i];
    const hasText = (tab?.text ?? "").trim().length > 0;
    const message = hasText
      ? `Delete tab "${tab.name}"? Its text will be lost.`
      : `Delete tab "${tab.name}"?`;
    if (!window.confirm(message)) {
      return;
    }
    saveEditorIntoActive();
    store.tabs.splice(i, 1);
    if (store.active > i) {
      store.active -= 1;
    } else if (store.active >= store.tabs.length) {
      store.active = store.tabs.length - 1;
    }
    loadActiveIntoEditor();
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
    saveEditorIntoActive();
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
    // Fresh node (or unreadable data): seed one tab from whatever text is
    // already in the editor so nothing is lost.
    store = parsed || {
      tabs: [{ name: "Tab 1", text: textWidget.value ?? "" }],
      active: 0,
    };
    loadActiveIntoEditor();
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
    const ta = findTextArea(textWidget);
    if (ta) { try { ta.removeEventListener("input", saveEditorIntoActive); } catch (e) {} }
  }

  // ---- DOM tab bar ---------------------------------------------------------

  // Outer element is sized by ComfyUI; the inner flex row keeps its natural
  // (wrapped) height, which we report back via computeSize.
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
    inner.replaceChildren(
      ...store.tabs.map((t, i) => makeTab(t, i)),
      makePlus()
    );
    node.setDirtyCanvas(true, true);
    scheduleAdjustEditorHeights(node);
  }

  const tabWidget = node.addDOMWidget("prompt_tabs_bar", "prompt_tabs_bar", bar, {
    serialize: false,
    hideOnZoom: false,
  });

  // Report the wrapped height. `inner` is never height-forced, so its measured
  // height reflects the real number of rows (grows/shrinks with wrap). The
  // height is cached by a ResizeObserver rather than read inside computeSize:
  // LiteGraph calls computeSize many times per frame, and a synchronous
  // offsetHeight read there forces a layout reflow each time — a measurable
  // jank source (the "Forced reflow" / long-rAF console violations).
  const tabH = trackHeight(node, inner, 24);
  tabWidget.computeSize = (width) => [width, tabH.h];

  // Place the tab bar directly above the text editor.
  const barIdx = node.widgets.indexOf(tabWidget);
  if (barIdx !== -1) {
    node.widgets.splice(barIdx, 1);
  }
  const textIdx = node.widgets.indexOf(textWidget);
  node.widgets.splice(textIdx === -1 ? node.widgets.length : textIdx, 0, tabWidget);

  // Live sync: keep the active tab (and `tabs_data`) up to date as the user
  // types, so switching tabs or saving never loses the current edit. This is
  // what makes the tab state track the editor in real time.
  const textArea = findTextArea(textWidget);
  if (textArea) {
    textArea.addEventListener("input", saveEditorIntoActive);
  }

  // Belt-and-suspenders: also flush at serialize/queue time in case the
  // editor element wasn't found above.
  dataWidget.serializeValue = () => {
    saveEditorIntoActive();
    return dataWidget.value;
  };

  node._promptTabs = { reload, cleanup };
  reload();

  // Size the editor once the Vue-rendered DOM exists (mount can land a little
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
// height. With our two rows (tab bar + editor) that splits the spare height
// between them, inflating the tab-bar row and wasting space. Pin the non-editor
// rows to `min-content` so only the editor row stretches. The editor row stays
// `auto` (min = the textarea's `min-h-16`), so the node can still be shrunk —
// NOT an explicit pixel height, which would force the node minimum height up and
// make it un-shrinkable.
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
  // is never re-applied to the fresh grid and the editor reverts to ComfyUI's
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
