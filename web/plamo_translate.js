import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

// PlamoTranslate-F — local translation with pfnet/plamo-3-translate-0.8b run
// through `transformers` on the backend. The model is downloaded automatically
// on first use and translation happens during graph execution (Queue Prompt),
// exactly like Gemma Translate but without a CLIPLoader.
//
// This frontend only adds the result/UX pieces that have no backend input:
//   * a read/edit "translated" textarea that is filled from the execution
//     result (the backend pushes it via the `ui` payload, ShowText-style),
//   * a "⇅ 入れ替え" button that swaps the source and translated text, and
//   * a "Live" toggle: while ON, the source text is watched and translated
//     through POST /promptpalette_f/plamo_translate once typing pauses — no
//     Queue Prompt needed. Not saved with the workflow (always starts OFF) and
//     inactive while the `text` input is wired from another node.
// All are native widgets so they work in the Classic (LiteGraph) and Nodes 2.0
// (Vue) renderers without the DOM-widget machinery the tab nodes need.

const LIVE_POLL_MS = 250; // how often the source text / settings are compared
const LIVE_DEBOUNCE_MS = 700; // quiet time after the last change before translating
const LIVE_BUSY_RETRY_MS = 1500; // wait before retrying after a "busy" answer
const LIVE_SLOW_MS = 1500; // after this, hint that the model may be loading

// Settings that change the translation; a change re-translates like an edit.
const LIVE_SETTING_NAMES = [
  "target_language",
  "d_tag_mode",
  "japanese_form",
  "max_new_tokens",
  "use_cache",
  "device",
];

function findWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

// Lazily create (once) the display textarea that holds the translation result.
function ensureTranslatedWidget(node) {
  if (node._plamoTranslated) {
    return node._plamoTranslated;
  }
  const widget = ComfyWidgets["STRING"](
    node,
    "translated",
    ["STRING", { multiline: true }],
    app
  ).widget;
  // Display field for the execution result. It is editable (so the swap button
  // and manual tweaks work) but intentionally not serialized into the saved
  // workflow — it has no backend input and is repopulated on the next run.
  widget.serializeValue = async () => "";
  node._plamoTranslated = widget;
  return widget;
}

// Add the source <-> translated swap button exactly once.
function ensureSwapButton(node) {
  if (node._plamoSwapAdded) {
    return;
  }
  node._plamoSwapAdded = true;
  node.addWidget("button", "⇅ 入れ替え", null, () => {
    const src = findWidget(node, "text");
    const dst = ensureTranslatedWidget(node);
    if (!src) {
      return;
    }
    const tmp = src.value;
    src.value = dst.value;
    dst.value = tmp;
    app.graph.setDirtyCanvas(true, false);
  });
}

// ---------------------------------------------------------------------------
// Live translation
// ---------------------------------------------------------------------------

// Page-wide state shared by every PlamoTranslate-F node: whether an IME
// composition is in progress (never translate half-converted text) and whether
// ComfyUI is running / holding queued jobs (loading the model then would evict
// the job's models). Installed once; constant memory.
const liveGlobal = { composing: false, queueBusy: false };

function installLiveGlobalHooks() {
  if (window.__plamoLiveHooked) {
    return;
  }
  window.__plamoLiveHooked = true;
  document.addEventListener("compositionstart", () => (liveGlobal.composing = true), true);
  document.addEventListener("compositionend", () => (liveGlobal.composing = false), true);
  api.addEventListener("status", (e) => {
    const remaining = e?.detail?.exec_info?.queue_remaining;
    liveGlobal.queueBusy = typeof remaining === "number" && remaining > 0;
  });
}

function isTextWired(node) {
  const slot = node.inputs?.find((i) => i.name === "text");
  return !!slot && slot.link != null;
}

function setLiveStatus(node, message) {
  const widget = node._plamoLiveStatus;
  if (widget && widget.value !== message) {
    widget.value = message;
    app.graph.setDirtyCanvas(true, false);
  }
}

// Everything the translation depends on, as plain data for the request body.
function collectLiveRequest(node) {
  const text = findWidget(node, "text")?.value;
  const body = { text: typeof text === "string" ? text : "" };
  for (const name of LIVE_SETTING_NAMES) {
    const widget = findWidget(node, name);
    if (widget) {
      body[name] = widget.value;
    }
  }
  return body;
}

async function postJson(path, body) {
  const response = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }
  if (!data || typeof data !== "object") {
    return { error: `HTTP ${response.status}` };
  }
  return data;
}

async function requestLiveTranslation(node, state, body, signature) {
  state.inflight = true;
  setLiveStatus(node, "翻訳中…");
  const slowTimer = setTimeout(() => {
    if (state.inflight) {
      setLiveStatus(node, "翻訳中…（初回はモデルの読み込み / ダウンロードに時間がかかります）");
    }
  }, LIVE_SLOW_MS);
  let data;
  try {
    data = await postJson("/promptpalette_f/plamo_translate", body);
  } catch (err) {
    data = { error: String(err?.message || err) };
  }
  clearTimeout(slowTimer);
  state.inflight = false;
  if (!state.on || node._plamoLive !== state) {
    return; // switched off / node removed while the request was running
  }
  if (data.busy) {
    state.holdUntil = Date.now() + LIVE_BUSY_RETRY_MS;
    setLiveStatus(node, "生成ジョブの実行中 — 終わり次第翻訳します");
    return;
  }
  if (typeof data.error === "string") {
    // Don't retry the same text in a loop; the next edit tries again.
    state.doneSig = signature;
    setLiveStatus(node, "翻訳失敗: " + data.error.split("\n")[0]);
    console.warn("[PlamoTranslate-F] live translation failed:\n" + data.error);
    return;
  }
  if (signature !== state.seenSig) {
    return; // the text moved on while we waited; the next tick re-translates
  }
  state.doneSig = signature;
  ensureTranslatedWidget(node).value =
    typeof data.translated === "string" ? data.translated : "";
  setLiveStatus(node, "");
  app.graph.setDirtyCanvas(true, false);
}

function liveTick(node, state) {
  if (!state.on) {
    return;
  }
  const toggle = node._plamoLiveToggle;
  if (isTextWired(node)) {
    // The value comes from another node and only exists at graph execution.
    state.seenSig = null;
    state.doneSig = null;
    setLiveStatus(node, "text が他ノードから接続されているため Live は無効です");
    return;
  }
  if (toggle && toggle.value !== true) {
    stopLive(node); // toggled off without the callback firing
    return;
  }
  const body = collectLiveRequest(node);
  const signature = JSON.stringify(body);
  const now = Date.now();
  if (signature !== state.seenSig) {
    state.seenSig = signature;
    state.changedAt = now;
  }
  if (signature === state.doneSig || state.inflight) {
    return;
  }
  if (!body.text.trim()) {
    state.doneSig = signature;
    ensureTranslatedWidget(node).value = "";
    setLiveStatus(node, "");
    app.graph.setDirtyCanvas(true, false);
    return;
  }
  if (liveGlobal.composing || now - state.changedAt < LIVE_DEBOUNCE_MS) {
    return;
  }
  if (now < state.holdUntil) {
    return;
  }
  if (liveGlobal.queueBusy) {
    setLiveStatus(node, "生成ジョブの実行中 — 終わり次第翻訳します");
    return;
  }
  requestLiveTranslation(node, state, body, signature);
}

function startLive(node) {
  stopLive(node, true);
  installLiveGlobalHooks();
  const state = {
    on: true,
    seenSig: null,
    doneSig: null,
    changedAt: 0,
    holdUntil: 0,
    inflight: false,
    timer: null,
  };
  node._plamoLive = state;
  state.timer = setInterval(() => liveTick(node, state), LIVE_POLL_MS);
  setLiveStatus(node, "");
}

// `silent` skips the unload request (restart / node removal / workflow load).
function stopLive(node, silent = false) {
  const state = node._plamoLive;
  if (!state) {
    return;
  }
  node._plamoLive = null;
  state.on = false;
  clearInterval(state.timer);
  setLiveStatus(node, "");
  // Live translations never unload the model themselves (it would reload on
  // every pause). Honor `unload_after` once, now that Live is over.
  if (!silent && findWidget(node, "unload_after")?.value === true) {
    postJson("/promptpalette_f/plamo_unload", {}).catch(() => {});
  }
}

// Add the Live toggle + its status line exactly once. Both are frontend-only:
// `serialize: false` keeps them out of the prompt, and they are appended after
// every other widget so saved `widgets_values` indices never shift.
function ensureLiveWidgets(node) {
  if (node._plamoLiveToggle) {
    return;
  }
  const toggle = node.addWidget(
    "toggle",
    "Live",
    false,
    (value) => {
      if (value) {
        startLive(node);
      } else {
        stopLive(node);
      }
    },
    { on: "ON", off: "OFF", serialize: false }
  );
  toggle.serialize = false;
  toggle.tooltip =
    "ON の間、text の入力が止まったタイミングで自動翻訳します（Queue 不要）。" +
    "text に他ノードを接続している間は無効。ワークフローには保存されません。";
  node._plamoLiveToggle = toggle;

  const status = node.addWidget("text", "Live status", "", () => {}, { serialize: false });
  status.serialize = false;
  status.disabled = true;
  node._plamoLiveStatus = status;
}

// Live is never restored from a saved workflow: force it OFF after a load.
function resetLive(node) {
  stopLive(node, true);
  if (node._plamoLiveToggle) {
    node._plamoLiveToggle.value = false;
  }
  if (node._plamoLiveStatus) {
    node._plamoLiveStatus.value = "";
  }
}

app.registerExtension({
  name: "idfa.PlamoTranslateF",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PlamoTranslate_F") {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      ensureTranslatedWidget(this);
      ensureSwapButton(this);
      ensureLiveWidgets(this);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      resetLive(this);
      return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      stopLive(this, true);
      return onRemoved?.apply(this, arguments);
    };

    // The backend returns { ui: { translated: [text] } }; ComfyUI delivers that
    // here as message.translated. Mirror ShowText: drop it into the display
    // textarea so the user sees the result on the node.
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      let value = message?.translated;
      if (Array.isArray(value)) {
        value = value.join("");
      }
      if (typeof value === "string") {
        const widget = ensureTranslatedWidget(this);
        widget.value = value;
        app.graph.setDirtyCanvas(true, false);
      }
    };
  },
});
