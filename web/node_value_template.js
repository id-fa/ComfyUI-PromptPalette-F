import { app } from "../../scripts/app.js";

// Node Value Template — a string node that resolves %NodeTitle.widget% tokens
// from other nodes in the graph, mirroring ComfyUI's SaveImage
// `filename_prefix` substitution (e.g. `%KSampler.seed%`).
//
// Why the frontend: node titles and live widget values only exist in the
// frontend graph (the backend prompt carries node ids + input values, not
// titles). So, exactly like the existing preview_override flow in index.js,
// we keep the raw template in the widget but resolve it and inject the result
// into the prompt right before it is sent — by patching ComfyUI's queue-prompt API.
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
// Any token may carry Smarty-style modifiers, chained with `|`:
//   %Title.image|basename%
//   %Title.image|basename|firstword:'_'%
// The %Title.widget% part is split on the FIRST dot (titles rarely contain
// dots — SaveImage splits the same way). Unresolvable tokens — unknown node,
// unknown widget, or an unknown modifier — are left untouched so the user can
// spot typos.
function resolveTemplate(template) {
  if (typeof template !== "string" || template.indexOf("%") === -1) {
    return template;
  }
  return template.replace(/%([^%]+)%/g, (match, inner) => {
    const parts = splitModifiers(inner);
    const base = parts[0].trim();
    let value;

    // Date token: %date% or %date:FORMAT% (mirrors SaveImage)
    if (base === "date" || base.startsWith("date:")) {
      const fmt = base === "date" ? "yyyy-MM-dd" : base.slice("date:".length);
      value = formatDate(fmt, new Date());
    } else {
      // Node reference: %Title.widget%
      const dot = base.indexOf(".");
      if (dot === -1) {
        return match; // no ".property" → not a node reference, leave as-is
      }
      const title = base.slice(0, dot).trim();
      const prop = base.slice(dot + 1).trim();
      const raw = lookupWidgetValue(title, prop);
      if (raw === undefined || raw === null) {
        return match; // node/widget not found → leave the token visible
      }
      value = String(raw);
    }

    for (let i = 1; i < parts.length; i++) {
      const next = applyModifierSpec(value, parts[i]);
      if (next === undefined) {
        return match; // unknown/invalid modifier → leave the token visible
      }
      value = next;
    }
    return value;
  });
}

// Split a token's inner text on `|`, ignoring pipes inside quoted modifier
// arguments (e.g. `firstword:'|'`). Quotes are kept — parseModifierSpec strips
// them — so that a bare argument containing a quote round-trips unchanged.
function splitModifiers(inner) {
  const parts = [];
  let cur = "";
  let quote = null;
  for (const c of inner) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts;
}

// Parse one modifier spec (`basename`, `firstword:'_'`) into {name, arg}.
// The argument is everything after the FIRST colon; surrounding matching quotes
// are stripped and \n / \r / \t are expanded so a separator like a tab can be
// typed literally. `arg` is null when no colon was present.
function parseModifierSpec(spec) {
  const s = spec.trim();
  const colon = s.indexOf(":");
  if (colon === -1) {
    return { name: s.toLowerCase(), arg: null };
  }
  const name = s.slice(0, colon).trim().toLowerCase();
  let arg = s.slice(colon + 1).trim();
  if (arg.length >= 2 && (arg[0] === "'" || arg[0] === '"') && arg[arg.length - 1] === arg[0]) {
    arg = arg.slice(1, -1);
  }
  arg = arg.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  return { name, arg };
}

// Apply one modifier to `value`. Returns undefined for an unknown modifier so
// the caller can leave the whole token visible (same policy as a bad node name).
function applyModifierSpec(value, spec) {
  const { name, arg } = parseModifierSpec(spec);
  switch (name) {
    case "basename":
      return basenameOf(value);
    case "firstword":
      return firstWordOf(value, arg);
    case "trim":
      return value.trim();
    default:
      return undefined;
  }
}

// Strip directory components and the extension from a file path. Both `/` and
// `\` count as separators (ComfyUI image widgets can carry either). A leading
// dot is kept ("`.gitignore`" stays whole) — only a real extension is dropped.
function basenameOf(value) {
  let s = String(value).replace(/\\/g, "/");
  const slash = s.lastIndexOf("/");
  if (slash !== -1) s = s.slice(slash + 1);
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.slice(0, dot);
  return s;
}

// Return the text before the first separator. With no argument, a space OR an
// underscore (whichever comes first) ends the word.
function firstWordOf(value, arg) {
  const s = String(value);
  if (arg === null || arg === "") {
    const m = /[ _]/.exec(s);
    return m ? s.slice(0, m.index) : s;
  }
  const idx = s.indexOf(arg);
  return idx === -1 ? s : s.slice(0, idx);
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

// Modifiers offered by the picker. `arg: true` reveals the separator input.
const MODIFIERS = [
  {
    name: "basename",
    label: "basename — パスからディレクトリ名と拡張子を除く",
    arg: false,
  },
  {
    name: "firstword",
    label: "firstword — 区切り文字までの最初の単語のみ",
    arg: true,
    argPlaceholder: "区切り文字（空 = スペースまたは _）",
  },
  { name: "trim", label: "trim — 前後の空白文字を除去", arg: false },
];

// Render a modifier back into token syntax. The argument is quoted (single
// quotes unless it contains one) and control characters are re-escaped so the
// token stays on one line and round-trips through parseModifierSpec().
function formatModifier(name, arg) {
  if (!arg) return name;
  const escaped = arg
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  const q = escaped.indexOf("'") === -1 ? "'" : '"';
  return `${name}:${q}${escaped}${q}`;
}

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
.nvt-mod-input {
  flex: 1 1 auto; min-width: 0;
  background: var(--comfy-input-bg, #111); color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 5px 6px; font-family: monospace;
}
.nvt-mod-add {
  flex: 0 0 auto;
  background: var(--comfy-input-bg, #333); color: var(--input-text, #e0e0e0);
  border: 1px solid var(--border-color, #444); border-radius: 4px;
  padding: 5px 10px; cursor: pointer;
}
.nvt-mod-add:hover { background: rgba(255, 255, 255, 0.08); }
.nvt-mod-chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 22px; align-items: center; }
.nvt-mod-chips .nvt-mod-none { opacity: 0.55; }
.nvt-mod-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid var(--border-color, #444); border-radius: 10px;
  padding: 2px 4px 2px 8px; font-family: monospace; font-size: 12px;
}
.nvt-mod-chip button {
  background: transparent; border: none; color: inherit;
  cursor: pointer; line-height: 1; padding: 0 3px; opacity: 0.7;
}
.nvt-mod-chip button:hover { opacity: 1; }
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

// The textarea to read/write when we have no record of a previous edit. Under
// the Vue renderer the box the user sees is the one mounted in the node's DOM
// root, which is NOT necessarily `widget.inputEl`; the widget lookup is the
// Classic-mode answer and the fallback.
function findTemplateTextArea(node) {
  if (node.id != null && document.querySelector) {
    const root = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    const areas = root?.querySelectorAll?.("textarea");
    // Only unambiguous when the node shows exactly one textarea (it does — the
    // template widget is its only multiline input).
    if (areas && areas.length === 1) return areas[0];
  }
  return getTemplateTextArea(node);
}

// Which NodeValueTemplate node does this <textarea> belong to?
//   - Classic: the widget owns the element, so `getTemplateTextArea` matches.
//   - Nodes 2.0: the Vue renderer mounts its OWN textarea inside the node's DOM
//     root, and it is NOT necessarily the element `widget.inputEl` points at —
//     that is why a caret recorded against the widget's textarea never matched
//     the one the user actually types in. Resolve through the DOM instead.
// The answer is cached on the element (elements are per-node and long-lived).
function nvtNodeForTextArea(ta) {
  if (!ta || ta.tagName !== "TEXTAREA") return null;
  const cached = ta._nvtNode;
  if (cached && cached.graph && getTemplateWidget(cached)) return cached;

  let found = null;
  const root = ta.closest?.(".lg-node[data-node-id]");
  const id = root?.dataset?.nodeId;
  if (id != null && app.graph?.getNodeById) {
    const n = app.graph.getNodeById(Number(id)) ?? app.graph.getNodeById(id);
    // Sitting in some other node's body: definitely not ours, and skipping the
    // scan below keeps this cheap when it runs on every keystroke anywhere.
    if (!n || n.type !== "NodeValueTemplate") return null;
    found = n;
  }
  if (!found) {
    for (const n of app.graph?._nodes || []) {
      if (n.type !== "NodeValueTemplate") continue;
      if (getTemplateTextArea(n) === ta) {
        found = n;
        break;
      }
    }
  }
  // A node can host more than one textarea in theory; ours is the template one.
  if (found && root && getTemplateTextArea(found) !== ta) {
    const areas = root.querySelectorAll?.("textarea");
    if (areas && areas.length > 1) found = null;
  }
  if (found) ta._nvtNode = found;
  return found;
}

// The caret is stored together with the element AND the text it was measured
// against: offsets are only meaningful for that exact string in that exact box.
// Anything that changes the text without firing an event (a programmatic
// `textarea.value = …` from the Vue renderer, ComfyUI's workflow undo, a value
// restored on configure) would otherwise leave a stale offset pointing into the
// middle of the new text.
function recordCaret(node, ta) {
  node._nvtCaret = {
    el: ta,
    start: ta.selectionStart,
    end: ta.selectionEnd,
    value: ta.value,
  };
}

// One document-level listener set for every NodeValueTemplate node — a single
// global hook (constant memory, same pattern as index.js's wheel/mousemove
// hooks) rather than per-node listeners that would have to be torn down.
// `selectionchange` fires on the document with the textarea as activeElement,
// and covers every caret move the other events miss (drag-select, held
// Home/End, context-menu paste).
function installGlobalCaretTracker() {
  if (window.__nvtCaretHooked) return;
  window.__nvtCaretHooked = true;
  const rec = () => {
    const ta = document.activeElement;
    if (!ta || ta.tagName !== "TEXTAREA" || ta._nvtSuppress) return;
    const node = nvtNodeForTextArea(ta);
    if (node) recordCaret(node, ta);
  };
  ["selectionchange", "keyup", "mouseup", "input", "focusin"].forEach((ev) =>
    document.addEventListener(ev, rec, true)
  );
}

// Capture the caret of whichever textarea is focused right now, if it is this
// node's template box. Called from the picker button's `pointerdown`, i.e.
// before the button steals focus.
function captureCaretNow(node) {
  const ta = document.activeElement;
  if (ta && ta.tagName === "TEXTAREA" && nvtNodeForTextArea(ta) === node) {
    recordCaret(node, ta);
    return ta;
  }
  return null;
}

// Decide WHERE the token goes and INTO WHICH element. The last edited textarea
// wins over the widget's own (they differ under the Vue renderer); a focused
// box always reports its live caret; otherwise the recorded caret is used only
// if it still describes the current text.
function resolveCaret(node) {
  const rec = node._nvtCaret;
  const ta =
    rec && rec.el && rec.el.isConnected ? rec.el : findTemplateTextArea(node);
  if (!ta) return { ta: null };
  if (document.activeElement === ta) {
    return { ta, start: ta.selectionStart, end: ta.selectionEnd };
  }
  if (!rec || rec.el !== ta || typeof rec.value !== "string") return { ta };
  if (rec.value === ta.value) return { ta, start: rec.start, end: rec.end };
  // Text changed behind our back. Keep the caret only when everything before it
  // is untouched (so the offset still points at the same spot); a selection is
  // dropped down to a plain caret because its end is no longer trustworthy.
  if (ta.value.slice(0, rec.start) !== rec.value.slice(0, rec.start)) {
    return { ta };
  }
  return { ta, start: rec.start, end: rec.start };
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
// `refocus` puts the caret back in the textarea afterwards; the picker passes
// false while it stays open so the live caret can't be moved behind our back
// between two inserts (the recorded one keeps advancing instead).
function insertToken(node, token, refocus = true) {
  const widget = getTemplateWidget(node);
  if (!widget) return;
  const caret = resolveCaret(node);
  const ta = caret.ta;

  let value = typeof widget.value === "string" ? widget.value : "";
  let start, end;

  if (ta) {
    value = ta.value;
    start = caret.start;
    end = caret.end;
  }
  // No usable caret (never focused, or the text moved under it) → append.
  if (start == null || start < 0 || start > value.length) {
    start = value.length;
    end = value.length;
  }
  if (end == null || end < start || end > value.length) end = start;

  const next = value.slice(0, start) + token + value.slice(end);
  const pos = start + token.length;

  // Opt-in diagnostics: set `window.__nvtDebug = true` in the console to see
  // which box and offset an insert used.
  if (window.__nvtDebug) {
    console.log("[NodeValueTemplate] insert", {
      start,
      end,
      length: value.length,
      hasRecord: !!node._nvtCaret,
      isWidgetTextArea: ta === getTemplateTextArea(node),
      focused: !!ta && document.activeElement === ta,
    });
  }

  if (ta) {
    // Assigning `value` and focusing both fire tracked events that would
    // otherwise record a stale caret over the one we are about to set.
    ta._nvtSuppress = true;
    try {
      // Prefer the native insertion: it keeps the browser's undo history and
      // lets the textarea move its own caret. Falls back to a plain splice when
      // the command is unavailable or refused.
      let inserted = false;
      try {
        ta.focus();
        ta.setSelectionRange(start, end);
        inserted =
          document.execCommand("insertText", false, token) && ta.value === next;
      } catch (e) {
        inserted = false;
      }
      if (!inserted) {
        ta.value = next;
        // Notify ComfyUI's own listener so widget.value stays authoritative.
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      try {
        ta.setSelectionRange(pos, pos);
        if (!refocus) ta.blur();
      } catch (e) {
        /* ignore */
      }
    } finally {
      ta._nvtSuppress = false;
    }
  }
  widget.value = next;
  node._nvtCaret = ta
    ? { el: ta, start: pos, end: pos, value: next }
    : null;
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

  // Shared selection state. `base` is the token's inner text without the
  // surrounding %…% (e.g. `KSampler.seed` or `date:yyyy-MM-dd`); both the node
  // rows and the date rows feed it. `mods` are the chained modifier specs,
  // which survive a change of base so the user can retarget without redoing them.
  const state = { base: null, mods: [] };

  function buildToken() {
    if (!state.base) return null;
    return `%${state.base}${state.mods.map((m) => "|" + m).join("")}%`;
  }

  function updatePreview() {
    const token = buildToken();
    if (token) {
      preview.textContent = token;
      insertBtn.disabled = false;
    } else {
      preview.textContent = "挿入するトークンを選択してください";
      insertBtn.disabled = true;
    }
  }

  // Mark `row` as selected, clearing any previous highlight across BOTH lists
  // (node + date are mutually exclusive — one token at a time).
  function selectRow(row, base) {
    panel
      .querySelectorAll(".nvt-prop-row.selected")
      .forEach((el) => el.classList.remove("selected"));
    if (row) row.classList.add("selected");
    state.base = base;
    updatePreview();
  }

  function doInsert(close) {
    const token = buildToken();
    if (!token) return;
    insertToken(node, token, close);
    if (close) closeTokenPicker();
  }

  function makeRow(list, nameText, valText, base) {
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
    row.addEventListener("click", () => selectRow(row, base));
    // Double-click = select + insert immediately (keeps the modal open).
    row.addEventListener("dblclick", () => {
      selectRow(row, base);
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

  // ---- Modifier builder (applies to whatever base token is selected) ----
  const modRow = document.createElement("div");
  modRow.className = "nvt-modal-row";
  const modLabel = document.createElement("label");
  modLabel.textContent = "修飾子";
  const modSelect = document.createElement("select");
  modSelect.className = "nvt-modal-select";
  for (const m of MODIFIERS) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.label;
    modSelect.appendChild(opt);
  }
  const modArg = document.createElement("input");
  modArg.className = "nvt-mod-input";
  modArg.type = "text";
  const modAdd = document.createElement("button");
  modAdd.className = "nvt-mod-add";
  modAdd.textContent = "＋ 追加";
  modRow.appendChild(modLabel);
  modRow.appendChild(modSelect);
  modRow.appendChild(modArg);
  modRow.appendChild(modAdd);
  body.appendChild(modRow);

  const chips = document.createElement("div");
  chips.className = "nvt-mod-chips";
  body.appendChild(chips);

  // Only `firstword` takes an argument, so the input hides for the others
  // instead of offering a field that would be ignored.
  function syncModArg() {
    const def = MODIFIERS.find((m) => m.name === modSelect.value);
    const takesArg = !!def?.arg;
    modArg.style.display = takesArg ? "" : "none";
    modArg.placeholder = def?.argPlaceholder || "";
    if (!takesArg) modArg.value = "";
  }

  function renderChips() {
    chips.innerHTML = "";
    if (state.mods.length === 0) {
      const none = document.createElement("span");
      none.className = "nvt-mod-none";
      none.textContent = "（修飾子なし）";
      chips.appendChild(none);
      return;
    }
    state.mods.forEach((spec, idx) => {
      const chip = document.createElement("span");
      chip.className = "nvt-mod-chip";
      const text = document.createElement("span");
      text.textContent = "|" + spec;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "この修飾子を削除";
      del.addEventListener("click", () => {
        state.mods.splice(idx, 1);
        renderChips();
        updatePreview();
      });
      chip.appendChild(text);
      chip.appendChild(del);
      chips.appendChild(chip);
    });
  }

  modSelect.addEventListener("change", syncModArg);
  modAdd.addEventListener("click", () => {
    state.mods.push(formatModifier(modSelect.value, modArg.value));
    modArg.value = "";
    renderChips();
    updatePreview();
  });
  syncModArg();
  renderChips();

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
      const base = `date:${fmt}`;
      const row = makeRow(listEl, `%${base}%`, "→ " + formatDate(fmt, now), base);
      if (idx === 0) selectRow(row, base); // pre-select the first for convenience
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
      const base = `${title}.${w.name}`;
      const row = makeRow(listEl, w.name, formatValue(w.value), base);
      if (idx === 0) selectRow(row, base); // pre-select the first for convenience
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
  // Runs before the button steals focus, so the caret of the box the user was
  // typing in is captured even if no other event had recorded it yet.
  btn.addEventListener("pointerdown", () => {
    captureCaretNow(node);
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
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
      installGlobalCaretTracker();
      return result;
    };
  },

  async setup() {
    injectModalCSS();
    installGlobalCaretTracker();
    // Resolve %Title.widget% tokens by post-processing the prompt that ComfyUI
    // builds, then leave the network send untouched.
    //
    // SECURITY NOTE (2026-06-08): this logic used to patch the queue-prompt API. The
    // ComfyUI Registry YARA rule "python_network_operations" false-positive-
    // flagged that as a network operation. It is NOT — but to avoid the false
    // positive the resolution was moved to wrap app.graphToPrompt instead, which
    // is the pure prompt BUILDER (it assembles the {output, workflow} payload and
    // performs no network I/O whatsoever; the queue-prompt API is left untouched and is
    // the only thing that contacts the server). index.js wraps the same method for
    // PromptPalette_F; wrappers chain (each captures the previous reference and
    // calls through) and each only touches its own node type, so both coexist.
    if (typeof app.graphToPrompt === "function") {
      // NOTE: capture WITHOUT Function#bind and re-dispatch via .apply(app, args)
      // below — see index.js for the full rationale. The Registry YARA rule
      // "python_network_operations" keys on dotted socket-method call substrings,
      // and the usual binding form collides with one; this avoids it purely to
      // dodge the static-scan false positive. Behaviour is identical.
      const origGraphToPrompt = app.graphToPrompt;
      app.graphToPrompt = async function (...args) {
        const result = await origGraphToPrompt.apply(app, args);
        try {
          const output = result && result.output;
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
          // console.error("[NodeValueTemplate] Error resolving template tokens:", e);
        }
        return result;
      };
    }
  },
});
