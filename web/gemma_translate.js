import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

// Gemma Translate — a single-pane translation node styled after "Prompt Tabs +
// Translate", but the translation is produced by an actual Gemma4 LLM
// generation during graph execution (not on a button click). The node takes a
// CLIP (a Gemma4 encoder from a CLIPLoader), a source text widget, a target
// language dropdown and a max-length / unload-after setting; the backend runs
// clip.tokenize -> clip.generate -> clip.decode and returns the translation.
//
// This frontend only adds the result/UX pieces that have no backend input:
//   * a read/edit "translated" textarea that is filled from the execution
//     result (the backend pushes it via the `ui` payload, ShowText-style), and
//   * a "⇅ 入れ替え" button that swaps the source and translated text.
// Both are native widgets so they work in the Classic (LiteGraph) and Nodes 2.0
// (Vue) renderers without the DOM-widget machinery the tab nodes need.

function findWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

// Lazily create (once) the display textarea that holds the translation result.
function ensureTranslatedWidget(node) {
  if (node._gemmaTranslated) {
    return node._gemmaTranslated;
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
  node._gemmaTranslated = widget;
  return widget;
}

// Add the source <-> translated swap button exactly once.
function ensureSwapButton(node) {
  if (node._gemmaSwapAdded) {
    return;
  }
  node._gemmaSwapAdded = true;
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
  name: "idfa.GemmaTranslate",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "GemmaTranslate") {
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
