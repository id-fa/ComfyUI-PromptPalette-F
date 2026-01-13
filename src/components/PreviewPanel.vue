<template>
  <div class="preview-panel" v-if="visible">
    <div class="preview-header">
      <span class="preview-title">Preview Output</span>
      <button @click="$emit('close')" class="close-btn">✕</button>
    </div>
    <div class="preview-content">
      <pre class="preview-text">{{ previewText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  visible: boolean
  lines: string[]
  separator: string
  prefix: string
  addNewline: boolean
  separatorNewline: boolean
  trailingSeparator: boolean
}

const props = defineProps<Props>()
defineEmits<{
  close: []
}>()

// Remove group tags (respecting escape characters)
function removeGroupTags(text: string): string {
  // First, protect escaped brackets
  text = text.replace(/\\\[/g, '\x00')
  text = text.replace(/\\\]/g, '\x01')

  // Remove group tags
  text = text.replace(/\[[\w-]+\]/g, '')

  // Restore escaped brackets
  text = text.replace(/\x00/g, '[')
  text = text.replace(/\x01/g, ']')

  return text
}

// Generate preview text (mirrors Python processing logic)
const previewText = computed(() => {
  const activeLines: string[] = []

  for (const line of props.lines) {
    const trimmed = line.trim()

    // Skip empty lines and description comments
    if (trimmed === '' || trimmed.startsWith('#')) continue

    // Skip commented lines
    if (trimmed.startsWith('//')) continue

    // Remove inline comments
    let cleanLine = line
    if (line.includes('//')) {
      cleanLine = line.split('//')[0]
    }

    // Remove group tags
    cleanLine = removeGroupTags(cleanLine)

    cleanLine = cleanLine.trim()
    if (cleanLine) {
      activeLines.push(cleanLine)
    }
  }

  // Build separator
  let sep = props.separator
  if (props.separatorNewline) {
    sep += '\n'
  }

  // Join lines
  let result = activeLines.join(sep)

  // Add trailing separator if requested
  if (props.trailingSeparator && activeLines.length > 0) {
    result += sep
  }

  // Add prefix if provided
  if (props.prefix) {
    result = props.prefix + (result ? sep + result : '')
  }

  // Add final newline if requested
  if (props.addNewline) {
    result += '\n'
  }

  return result || '(empty)'
})
</script>

<style scoped>
.preview-panel {
  border-top: 2px solid var(--border-color, #444);
  background: var(--comfy-menu-bg, #1a1a1a);
  display: flex;
  flex-direction: column;
  max-height: 200px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
}

.preview-title {
  font-weight: bold;
  font-size: 12px;
  color: var(--input-text, #ddd);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--input-text, #ddd);
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}

.close-btn:hover {
  background: var(--comfy-input-hover-bg, #333);
}

.preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.preview-text {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--input-text, #ddd);
}
</style>
