// @ts-ignore
import { app } from "../../../scripts/app.js";
import type { ComfyApp } from '@comfyorg/comfyui-frontend-types'

// @ts-ignore
import { ComponentWidgetImpl, addWidget } from "../../../scripts/domWidget.js";

import PromptPaletteWidget from "@/components/PromptPaletteWidget.vue";
// import TestWidget from "@/components/TestWidget.vue";

const comfyApp: ComfyApp = app;

console.log('[PromptPalette_F_Vue] Extension loading...')

comfyApp.registerExtension({
  name: 'PromptPalette_F_Vue',

  getCustomWidgets(_app) {
    console.log('[PromptPalette_F_Vue] getCustomWidgets called')

    return {
      PROMPT_PALETTE_VUE(node: any) {
        console.log('[PromptPalette_F_Vue] Creating custom widget for', node.constructor.comfyClass)

        const inputSpec = {
          name: 'prompt_palette_data',
          type: 'PROMPT_PALETTE_VUE'
        }

        const widget = new ComponentWidgetImpl({
          node,
          name: inputSpec.name,
          component: PromptPaletteWidget,
          inputSpec,
          options: {}
        })

        // Initialize with default values and sample text
        widget.value = {
          text: 'beautiful landscape\nsunset colors\n// dark scene\nhigh quality',
          separator: ', ',
          prefix: '',
          add_newline: false,
          separator_newline: false,
          trailing_separator: false
        }

        // Set widget size explicitly
        widget.computeSize = function() {
          return [400, 400]  // [width, height]
        }

        // Note: serializeValue will be set by Vue component in onMounted()

        // Add widget to node
        addWidget(node, widget)

        console.log('[PromptPalette_F_Vue] Widget created and added:', widget)
        console.log('[PromptPalette_F_Vue] Widget computeSize:', widget.computeSize())

        return { widget }
      }
    }
  },

  nodeCreated(node: any) {
    if (node.constructor.comfyClass !== 'PromptPalette_F_Vue') return

    console.log('[PromptPalette_F_Vue] nodeCreated for', node.type)
    console.log('[PromptPalette_F_Vue] Node widgets:', node.widgets?.map((w: any) => w.name))

    // Set minimum size for the node
    const [oldWidth, oldHeight] = node.size
    node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 400)])
  }
})

console.log('[PromptPalette_F_Vue] Extension registered')
