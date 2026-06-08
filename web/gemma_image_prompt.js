import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

// Gemma Image Prompt — an experimental node that uses a vision-capable Gemma4
// encoder to look at an input image and write a text-to-image prompt that would
// recreate a similar image, honoring free-form modification instructions and a
// few settings (output style, target model, detail mode). The actual analysis
// and generation happen in the backend during graph execution.
//
// This frontend only adds two read-only display fields (positive / negative)
// that are filled from the execution result, which the backend pushes via the
// `ui` payload (ShowText-style). They are native widgets so they render in both
// the Classic (LiteGraph) and Nodes 2.0 (Vue) renderers without any DOM-widget
// machinery.

// Lazily create (once) a multiline display widget for one output field.
function ensureDisplayWidget(node, key) {
  const cacheKey = "_gemmaImg_" + key;
  if (node[cacheKey]) {
    return node[cacheKey];
  }
  const widget = ComfyWidgets["STRING"](
    node,
    key,
    ["STRING", { multiline: true }],
    app
  ).widget;
  // Display field for the execution result — not serialized into the saved
  // workflow (it has no backend input and is repopulated on the next run).
  widget.serializeValue = async () => "";
  node[cacheKey] = widget;
  return widget;
}

app.registerExtension({
  name: "idfa.GemmaImagePrompt",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "GemmaImagePrompt") {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      ensureDisplayWidget(this, "positive");
      ensureDisplayWidget(this, "negative");
      return result;
    };

    // The backend returns { ui: { positive: [..], negative: [..] } }; ComfyUI
    // delivers that here as message.positive / message.negative. Mirror ShowText
    // and drop each into its display field.
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      for (const key of ["positive", "negative"]) {
        let value = message?.[key];
        if (Array.isArray(value)) {
          value = value.join("");
        }
        if (typeof value === "string") {
          ensureDisplayWidget(this, key).value = value;
        }
      }
      app.graph.setDirtyCanvas(true, false);
    };
  },
});
