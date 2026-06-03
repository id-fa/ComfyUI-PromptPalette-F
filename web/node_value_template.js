import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Node Value Template — a string node that resolves %NodeTitle.widget% tokens
// from other nodes in the graph, mirroring ComfyUI's SaveImage
// `filename_prefix` substitution (e.g. `%KSampler.seed%`).
//
// Why the frontend: node titles and live widget values only exist in the
// frontend graph (the backend prompt carries node ids + input values, not
// titles). So, exactly like the existing preview_override flow in index.js,
// we keep the raw template in the widget but resolve it and inject the result
// into the prompt right before it is sent — by patching api.queuePrompt.
//
// A "Insert token" button opens a modal helper: pick a node title from a
// dropdown, see that node's widget names + current values, and insert the
// chosen %Title.widget% token at the caret position in the template.

// ---------------------------------------------------------------------------
// Token resolution (queue time)
// ---------------------------------------------------------------------------

// Replace tokens in `template`:
//   %date:FORMAT%  — current date/time formatted like SaveImage's filename_prefix
//   %date%         — shorthand for %date:yyyy-MM-dd%
//   %Title.widget% — current value of the named widget on the node titled Title
// The %Title.widget% part is split on the FIRST dot (titles rarely contain
// dots — SaveImage splits the same way). Unresolvable tokens are left untouched
// so the user can spot typos.
function resolveTemplate(template) {
  if (typeof template !== "string" || template.indexOf("%") === -1) {
    return template;
  }
  return template.replace(/%([^%]+)%/g, (match, inner) => {
    // Date token: %date% or %date:FORMAT% (mirrors SaveImage)
    if (inner === "date" || inner.startsWith("date:")) {
      const fmt = inner === "date" ? "yyyy-MM-dd" : inner.slice("date:".length);
      return formatDate(fmt, new Date());
    }

    // Node reference: %Title.widget%
    const dot = inner.indexOf(".");
    if (dot === -1) {
      return match; // no ".property" → not a node reference, leave as-is
    }
    const title = inner.slice(0, dot).trim();
    const prop = inner.slice(dot + 1).trim();
    const value = lookupWidgetValue(title, prop);
    if (value === undefined || value === null) {
      return match; // node/widget not found → leave the token visible
    }
    return String(value);
  });
}

// Format a Date using SaveImage-style tokens. Supported (case-sensitive):
//   yyyy (4-digit year), yy (2-digit year),
//   MM/M (month), dd/d (day), hh/h (24h hour), mm/m (minute), ss/s (second).
// Any other character is emitted literally. Tokens are matched longest-first
// via a left-to-right scan so e.g. `yyyy` wins over `yy` and `MM` over `M`,
// and already-substituted digits are never re-matched.
function formatDate(format, dt) {
  const z2 = (n) => String(n).padStart(2, "0");
  const map = {
    yyyy: String(dt.getFullYear()),
    yy: String(dt.getFullYear()).slice(-2),
    MM: z2(dt.getMonth() + 1),
    M: String(dt.getMonth() + 1),
    dd: z2(dt.getDate()),
    d: String(dt.getDate()),
    hh: z2(dt.getHours()),
    h: String(dt.getHours()),
    mm: z2(dt.getMinutes()),
    m: String(dt.getMinutes()),
    ss: z2(dt.getSeconds()),
    s: String(dt.getSeconds()),
  };
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  let result = "";
  let i = 0;
  while (i < format.length) {
    let matched = false;
    for (const key of keys) {
      if (format.startsWith(key, i)) {
        result += map[key];
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += format[i];
      i += 1;
    }
  }
  return result;
}

// Find the first node whose title matches `title` and return the value of its
// widget named `prop`. `node.title` falls back to the node type's display name
// in LiteGraph, which is what the user sees and what SaveImage matches against.
function lookupWidgetValue(title, prop) {
  const nodes = app.graph?._nodes || [];
  for (const n of nodes) {
    const nodeTitle = n.title || n.type;
    if (nodeTitle !== title) {
      continue;
    }
    const w = n.widgets?.find((x) => x.name === prop);
    if (w) {
      return w.value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Token picker modal
// ---------------------------------------------------------------------------

// Sentinel <option> value for the "date format" entry that lives inside the
// node-title dropdown. Distinct enough that collision with a real node title
// is effectively impossible.
const NVT_DATE_OPTION = "__nvt_date__";

// Sample %date:FORMAT% presets offered in the picker. The live preview next to
// each is produced by formatDate() at modal-open time.
const DATE_SAMPLES = [
  "yyyy-MM-dd",
  "yyyy-MM-dd_hh-mm-ss",
  "yyyyMMdd",
  "yyyyMMdd_hhmmss",
  "yyyy/MM/dd",
  "yyyy-MM",
  "hh-mm-ss",
];

const MODAL_CSS = `
.nvt-modal-backdrop {
  position: fixed; inset: 0; z-index: 10010;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
}
.nvt-modal-panel {
  background: var(--comfy-menu-bg, #202020);
  color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}
.nvt-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, #444);
}
.nvt-modal-header b { font-size: 14px; }
.nvt-modal-close {
  background: transparent; border: none; color: var(--input-text, #e0e0e0);
  font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px;
}
.nvt-modal-body { padding: 12px 14px; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
.nvt-modal-row { display: flex; align-items: center; gap: 8px; }
.nvt-modal-row label { flex: 0 0 auto; opacity: 0.85; }
.nvt-modal-select {
  flex: 1 1 auto; min-width: 0;
  background: var(--comfy-input-bg, #111); color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 5px 6px;
}
.nvt-prop-list {
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  background: var(--comfy-input-bg, #111);
  max-height: 230px; overflow-y: auto;
}
.nvt-prop-row {
  display: flex; gap: 8px; align-items: baseline;
  padding: 6px 10px; cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.nvt-prop-row:last-child { border-bottom: none; }
.nvt-prop-row:hover { background: rgba(255, 255, 255, 0.06); }
.nvt-prop-row.selected { background: var(--p-primary-color, #2563eb); color: #fff; }
.nvt-prop-name { flex: 0 0 auto; font-weight: 600; }
.nvt-prop-val {
  flex: 1 1 auto; min-width: 0; opacity: 0.8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: monospace;
}
.nvt-prop-row.selected .nvt-prop-val { opacity: 0.95; }
.nvt-modal-empty { padding: 16px; text-align: center; opacity: 0.7; }
.nvt-modal-footer {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-top: 1px solid var(--border-color, #444);
}
.nvt-token-preview {
  flex: 1 1 auto; min-width: 0;
  font-family: monospace; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  opacity: 0.9;
}
.nvt-btn {
  background: var(--comfy-input-bg, #333); color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 6px 14px; cursor: pointer;
}
.nvt-btn:disabled { opacity: 0.45; cursor: default; }
.nvt-btn-primary { background: var(--p-primary-color, #2563eb); color: #fff; border-color: transparent; }
.nvt-pick-wrap {
  display: flex; align-items: center; width: 100%;
  box-sizing: border-box; padding: 0 4px; height: 100%;
}
.nvt-pick-btn {
  width: 100%; box-sizing: border-box; height: 24px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--comfy-input-bg, #333); color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 0 8px; cursor: pointer; font-size: 12px;
}
.nvt-pick-btn:hover { background: rgba(255, 255, 255, 0.08); }
`;

function injectModalCSS() {
  if (document.getElementById("nvt-modal-css")) return;
  const style = document.createElement("style");
  style.id = "nvt-modal-css";
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

function getTemplateWidget(node) {
  return node.widgets?.find((w) => w.name === "template");
}

// The multiline STRING widget keeps its <textarea> in `inputEl` (ComfyUI) or
// `element` depending on version. Return the live textarea so we can insert at
// the caret and keep the widget value in sync.
function getTemplateTextArea(node) {
  const widget = getTemplateWidget(node);
  if (!widget) return null;
  const el = widget.inputEl || widget.element;
  if (!el) return null;
  if (el.tagName === "TEXTAREA") return el;
  if (el.querySelector) return el.querySelector("textarea");
  return null;
}

// Record the caret position whenever the user interacts with the textarea, so
// that clicking the (blur-causing) picker button doesn't lose the insertion
// point. Attached once per textarea.
function ensureCaretTracker(node) {
  const ta = getTemplateTextArea(node);
  if (!ta || ta._nvtTracked) return ta;
  ta._nvtTracked = true;
  const rec = () => {
    node._nvtCaret = { start: ta.selectionStart, end: ta.selectionEnd };
  };
  ["keyup", "click", "select", "input", "focus", "blur"].forEach((ev) =>
    ta.addEventListener(ev, rec)
  );
  return ta;
}

// Map of title -> first node with that title (matching the resolver, which
// uses the first match). Only nodes that have named widgets and aren't `self`.
function collectTitleMap(selfNode) {
  const nodes = app.graph?._nodes || [];
  const map = new Map();
  for (const n of nodes) {
    if (n === selfNode) continue;
    const widgets = (n.widgets || []).filter((w) => w && w.name);
    if (widgets.length === 0) continue;
    const title = n.title || n.type;
    if (!map.has(title)) map.set(title, n);
  }
  return map;
}

function formatValue(v) {
  if (v === undefined) return "(undefined)";
  if (v === null) return "(null)";
  let s;
  if (typeof v === "object") {
    try {
      s = JSON.stringify(v);
    } catch (e) {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 160) s = s.slice(0, 157) + "…";
  return s;
}

function closeTokenPicker() {
  const existing = document.querySelector(".nvt-modal-backdrop");
  if (existing) existing.remove();
  if (window.__nvtKeyHandler) {
    document.removeEventListener("keydown", window.__nvtKeyHandler, true);
    window.__nvtKeyHandler = null;
  }
}

// Insert `token` into the template widget at the recorded caret position.
function insertToken(node, token) {
  const widget = getTemplateWidget(node);
  if (!widget) return;
  const ta = getTemplateTextArea(node);

  let value = typeof widget.value === "string" ? widget.value : "";
  let start, end;

  if (ta) {
    value = ta.value;
    const caret = node._nvtCaret;
    start = caret ? caret.start : ta.selectionStart;
    end = caret ? caret.end : ta.selectionEnd;
  }
  if (start == null || start < 0 || start > value.length) {
    start = value.length;
    end = value.length;
  }
  if (end == null || end < start) end = start;

  const next = value.slice(0, start) + token + value.slice(end);
  widget.value = next;

  const pos = start + token.length;
  node._nvtCaret = { start: pos, end: pos };

  if (ta) {
    ta.value = next;
    // Notify ComfyUI's own listener so widget.value stays authoritative.
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    } catch (e) {
      /* ignore */
    }
  }
  if (typeof widget.callback === "function") {
    try {
      widget.callback(widget.value);
    } catch (e) {
      /* ignore */
    }
  }
  app.graph?.setDirtyCanvas(true, true);
}

function openTokenPicker(node) {
  injectModalCSS();
  closeTokenPicker();
  ensureCaretTracker(node);

  const titleMap = collectTitleMap(node);
  const titles = Array.from(titleMap.keys()).sort((a, b) => a.localeCompare(b));

  const backdrop = document.createElement("div");
  backdrop.className = "nvt-modal-backdrop";

  const panel = document.createElement("div");
  panel.className = "nvt-modal-panel";
  backdrop.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "nvt-modal-header";
  const hb = document.createElement("b");
  hb.textContent = "値・日付トークンを挿入 / Insert token";
  const closeBtn = document.createElement("button");
  closeBtn.className = "nvt-modal-close";
  closeBtn.textContent = "✕";
  closeBtn.title = "閉じる (Esc)";
  closeBtn.addEventListener("click", closeTokenPicker);
  header.appendChild(hb);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "nvt-modal-body";
  panel.appendChild(body);

  // Footer
  const footer = document.createElement("div");
  footer.className = "nvt-modal-footer";
  panel.appendChild(footer);

  // Footer: token preview + insert (built first so selection handlers can use it)
  const preview = document.createElement("span");
  preview.className = "nvt-token-preview";
  const insertBtn = document.createElement("button");
  insertBtn.className = "nvt-btn nvt-btn-primary";
  insertBtn.textContent = "挿入";
  insertBtn.disabled = true;
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "nvt-btn";
  cancelBtn.textContent = "閉じる";
  footer.appendChild(preview);
  footer.appendChild(cancelBtn);
  footer.appendChild(insertBtn);
  cancelBtn.addEventListener("click", closeTokenPicker);

  // Shared selection state: the single currently-chosen token string (or null).
  // Both the node-value rows and the date-format rows feed this.
  const state = { token: null };

  function updatePreview() {
    if (state.token) {
      preview.textContent = state.token;
      insertBtn.disabled = false;
    } else {
      preview.textContent = "挿入するトークンを選択してください";
      insertBtn.disabled = true;
    }
  }

  // Mark `row` as selected, clearing any previous highlight across BOTH lists
  // (node + date are mutually exclusive — one token at a time).
  function selectRow(row, token) {
    panel
      .querySelectorAll(".nvt-prop-row.selected")
      .forEach((el) => el.classList.remove("selected"));
    if (row) row.classList.add("selected");
    state.token = token;
    updatePreview();
  }

  function doInsert(close) {
    if (!state.token) return;
    insertToken(node, state.token);
    if (close) closeTokenPicker();
  }

  function makeRow(list, nameText, valText, token) {
    const row = document.createElement("div");
    row.className = "nvt-prop-row";
    const name = document.createElement("span");
    name.className = "nvt-prop-name";
    name.textContent = nameText;
    const val = document.createElement("span");
    val.className = "nvt-prop-val";
    val.textContent = valText;
    val.title = valText;
    row.appendChild(name);
    row.appendChild(val);
    row.addEventListener("click", () => selectRow(row, token));
    // Double-click = select + insert immediately (keeps the modal open).
    row.addEventListener("dblclick", () => {
      selectRow(row, token);
      doInsert(false);
    });
    list.appendChild(row);
    return row;
  }

  // ---- Single dropdown (node titles + a "date format" entry) + one list ----
  const selectRowEl = document.createElement("div");
  selectRowEl.className = "nvt-modal-row";
  const titleLabel = document.createElement("label");
  titleLabel.textContent = "ノード / 日付";
  const titleSelect = document.createElement("select");
  titleSelect.className = "nvt-modal-select";

  // Blank first option so nothing is pre-selected until the user chooses.
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "";
  titleSelect.appendChild(placeholder);

  // Date-format entry lives inside the same dropdown as a special item.
  const dateOpt = document.createElement("option");
  dateOpt.value = NVT_DATE_OPTION;
  dateOpt.textContent = "📅 日付フォーマット (%date:…%)";
  titleSelect.appendChild(dateOpt);

  // Node titles (only nodes that have widgets; self excluded — see collectTitleMap).
  for (const t of titles) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    titleSelect.appendChild(opt);
  }
  selectRowEl.appendChild(titleLabel);
  selectRowEl.appendChild(titleSelect);
  body.appendChild(selectRowEl);

  // One list area, repopulated by the dropdown choice.
  const listEl = document.createElement("div");
  listEl.className = "nvt-prop-list";
  body.appendChild(listEl);

  function clearList() {
    listEl.innerHTML = "";
    selectRow(null, null); // switching choice drops the previous selection
  }

  function showHint(text) {
    const hint = document.createElement("div");
    hint.className = "nvt-modal-empty";
    hint.textContent = text;
    listEl.appendChild(hint);
  }

  function renderDates() {
    clearList();
    const now = new Date();
    DATE_SAMPLES.forEach((fmt, idx) => {
      const token = `%date:${fmt}%`;
      const row = makeRow(listEl, token, "→ " + formatDate(fmt, now), token);
      if (idx === 0) selectRow(row, token); // pre-select the first for convenience
    });
  }

  function renderProps(title) {
    clearList();
    if (!title) {
      showHint("ノードタイトルまたは日付フォーマットを選択してください。");
      return;
    }
    const targetNode = titleMap.get(title);
    const widgets = (targetNode?.widgets || []).filter((w) => w && w.name);
    if (widgets.length === 0) {
      showHint("このノードには参照できるウィジェットがありません。");
      return;
    }
    widgets.forEach((w, idx) => {
      const token = `%${title}.${w.name}%`;
      const row = makeRow(listEl, w.name, formatValue(w.value), token);
      if (idx === 0) selectRow(row, token); // pre-select the first for convenience
    });
  }

  titleSelect.addEventListener("change", () => {
    const v = titleSelect.value;
    if (v === NVT_DATE_OPTION) renderDates();
    else renderProps(v);
  });

  titleSelect.value = "";
  renderProps(""); // initial hint (nothing chosen yet)

  insertBtn.addEventListener("click", () => doInsert(true));
  updatePreview();

  mountModal(backdrop, panel);
}

function mountModal(backdrop, panel) {
  // Click outside the panel closes; clicks inside don't.
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeTokenPicker();
  });
  window.__nvtKeyHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeTokenPicker();
    }
  };
  document.addEventListener("keydown", window.__nvtKeyHandler, true);
  document.body.appendChild(backdrop);
}

// Add the "Insert token" button below the template widget. Uses a DOM widget
// so it stays interactive under both the Classic (LiteGraph) and Nodes 2.0
// (Vue) renderers, mirroring the prompt_tabs.js tab bar approach.
//
// IMPORTANT: the widget `type` must be a CUSTOM string, NOT "button". A "button"
// type makes the Nodes 2.0 (Vue) renderer treat it as a known widget and draw a
// labeled field from the widget NAME ("nvt_pick") instead of mounting our
// element — the button then looks like an inert "nvt_pick" row and clicks do
// nothing. A custom type (like prompt_tabs' "prompt_tabs_bar") bypasses Vue's
// widget-component mapping and just renders the DOM element. We also wrap the
// button in a flex container and report [width, h] from computeSize so the
// button fills the row and its label stays vertically centered in Classic mode.
function addPickerButton(node) {
  if (!node.addDOMWidget || node._nvtPickWidget) return;

  const wrap = document.createElement("div");
  wrap.className = "nvt-pick-wrap";

  const btn = document.createElement("button");
  btn.className = "nvt-pick-btn";
  btn.textContent = "🔍 ノードの値を挿入…";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ensureCaretTracker(node);
    openTokenPicker(node);
  });
  wrap.appendChild(btn);

  const widget = node.addDOMWidget("nvt_pick", "nvt_pick_btn", wrap, {
    serialize: false,
    hideOnZoom: false,
  });
  widget.computeSize = function (width) {
    return [width, 30];
  };
  node._nvtPickWidget = widget;
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "idfa.NodeValueTemplate",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "NodeValueTemplate") {
      return;
    }
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      injectModalCSS();
      addPickerButton(this);
      // The textarea is created shortly after; attach the caret tracker once
      // it exists (a single delayed attempt is enough — it no-ops if missing).
      setTimeout(() => ensureCaretTracker(this), 0);
      return result;
    };
  },

  async setup() {
    injectModalCSS();
    // Patch api.queuePrompt to resolve %Title.widget% tokens at queue time.
    // index.js patches the same method for PromptPalette_F; patches chain
    // (each captures the previous api.queuePrompt and calls through), so both
    // coexist safely as long as we only touch our own node type.
    const origQueuePrompt = api.queuePrompt.bind(api);
    api.queuePrompt = async function (number, { output, workflow }) {
      try {
        if (output) {
          for (const [nodeId, nodeData] of Object.entries(output)) {
            if (nodeData.class_type !== "NodeValueTemplate") {
              continue;
            }
            const node = app.graph.getNodeById(parseInt(nodeId));
            const widget = node?.widgets?.find((w) => w.name === "template");
            // Prefer the live widget value; fall back to whatever serialized
            // into the prompt (covers any future widget-hiding scenario).
            const raw = widget ? widget.value : nodeData.inputs.template;
            nodeData.inputs.template = resolveTemplate(raw);
          }
        }
      } catch (e) {
        console.error("[NodeValueTemplate] Error resolving template tokens:", e);
      }
      return origQueuePrompt(number, { output, workflow });
    };
  },
});
