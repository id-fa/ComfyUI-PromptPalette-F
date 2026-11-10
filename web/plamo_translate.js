import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

// PlamoTranslate-F — local translation with pfnet/plamo-3-translate-0.8b run
// through `transformers` on the backend. The model is downloaded automatically
// on first use and translation happens during graph execution (Queue Prompt),
// exactly like Gemma Translate but without a CLIPLoader.
//
// This frontend only adds the result/UX pieces that have no backend input:
//   * a read/edit "translated" textarea that is filled from the execution
//     result (the backend pushes it via the `ui` payload, ShowText-style), and
//   * a "⇅ 入れ替え" button that swaps the source and translated text.
// Both are native widgets so they work in the Classic (LiteGraph) and Nodes 2.0
// (Vue) renderers without the DOM-widget machinery the tab nodes need.
// Same structure as web/gemma_translate.js.

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
      return result;
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
