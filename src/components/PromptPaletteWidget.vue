<template>
  <div class="prompt-palette-widget">
    <!-- Edit/Display Mode Toggle -->
    <div class="toolbar">
      <button @click="editMode = !editMode" class="mode-toggle-btn">
        {{ editMode ? 'Display Mode' : 'Edit Mode' }}
      </button>
      <button @click="showPreview = !showPreview" class="preview-toggle-btn">
        {{ showPreview ? 'Hide Preview' : 'Show Preview' }}
      </button>
    </div>

    <!-- Edit Mode: Text Editor -->
    <div v-if="editMode" class="edit-mode">
      <textarea
        v-model="textContent"
        @input="handleTextChange"
        class="text-editor"
        rows="10"
        placeholder="Enter phrases (one per line)
Use // to comment out lines
Use [group] tags for grouping
Use (phrase:1.5) for weights"
      ></textarea>

      <div class="options-grid">
        <label class="option-label">
          <span>Separator:</span>
          <input
            v-model="separator"
            @input="handleSeparatorChange"
            type="text"
            class="separator-input"
            placeholder=", "
          />
        </label>

        <label class="option-label">
          <span>Prefix:</span>
          <input
            v-model="prefix"
            @input="handlePrefixChange"
            type="text"
            class="prefix-input"
            placeholder="Optional prefix"
          />
        </label>

        <label class="checkbox-label">
          <input
            v-model="addNewline"
            @change="handleOptionsChange"
            type="checkbox"
          />
          <span>Add newline at end</span>
        </label>

        <label class="checkbox-label">
          <input
            v-model="separatorNewline"
            @change="handleOptionsChange"
            type="checkbox"
          />
          <span>Newline after separator</span>
        </label>

        <label class="checkbox-label">
          <input
            v-model="trailingSeparator"
            @change="handleOptionsChange"
            type="checkbox"
          />
          <span>Trailing separator</span>
        </label>
      </div>
    </div>

    <!-- Display Mode: Interactive UI -->
    <div v-else class="display-mode">
      <GroupControls
        :lines="lines"
        @toggle-group="handleToggleGroup"
        @toggle-all="handleToggleAll"
      />

      <div class="phrases-list">
        <template v-for="(line, index) in lines" :key="`${index}-${line}`">
          <!-- Description comments -->
          <div v-if="isDescriptionComment(line)" class="description-comment">
            {{ line.replace(/^#\s*/, '') }}
          </div>

          <!-- Regular phrase rows -->
          <PhraseRow
            v-else-if="!isEmptyLine(line)"
            :line="lines[index]"
            :index="index"
            @update="handleLineUpdate"
          />
        </template>
      </div>
    </div>

    <!-- Preview Panel -->
    <PreviewPanel
      :visible="showPreview"
      :lines="lines"
      :separator="separator"
      :prefix="prefix"
      :add-newline="addNewline"
      :separator-newline="separatorNewline"
      :trailing-separator="trailingSeparator"
      @close="showPreview = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import PhraseRow from './PhraseRow.vue'
import GroupControls from './GroupControls.vue'
import PreviewPanel from './PreviewPanel.vue'

interface WidgetValue {
  text: string
  separator: string
  prefix: string
  add_newline: boolean
  separator_newline: boolean
  trailing_separator: boolean
  _cache_bust?: number  // Timestamp to prevent execution caching
}

const props = defineProps<{
  widget: any
}>()

const node = props.widget.node

// State
const editMode = ref(false)
const showPreview = ref(false)
const textContent = ref('beautiful landscape\nsunset colors\n// dark scene\nhigh quality')
const separator = ref(', ')
const prefix = ref('')
const addNewline = ref(false)
const separatorNewline = ref(false)
const trailingSeparator = ref(false)

// Computed
const lines = computed(() => {
  return textContent.value.split('\n')
})

// Helper functions
function isDescriptionComment(line: string): boolean {
  return line.trim().startsWith('#')
}

function isEmptyLine(line: string): boolean {
  return line.trim() === ''
}

function parseGroupTags(line: string): string[] {
  const cleanLine = line.replace(/^\/\/\s*/, '')
  const regex = /\[([^\]]+)\]/g
  const groups: string[] = []
  let match
  while ((match = regex.exec(cleanLine)) !== null) {
    groups.push(match[1])
  }
  return groups
}

// Event handlers
function handleTextChange() {
  updateWidgetValue()
}

function handleSeparatorChange() {
  updateWidgetValue()
}

function handlePrefixChange() {
  updateWidgetValue()
}

function handleOptionsChange() {
  updateWidgetValue()
}

function handleLineUpdate(index: number, newLine: string) {
  console.log('[PromptPaletteWidget] handleLineUpdate called', {
    index,
    oldLine: lines.value[index]?.substring(0, 30),
    newLine: newLine.substring(0, 30),
    allLinesBefore: lines.value
  })

  const newLines = [...lines.value]
  newLines[index] = newLine
  textContent.value = newLines.join('\n')

  console.log('[PromptPaletteWidget] After update', {
    textContent: textContent.value.substring(0, 100),
    allLinesAfter: textContent.value.split('\n')
  })

  updateWidgetValue()
}

function handleToggleGroup(groupName: string) {
  const newLines = lines.value.map(line => {
    if (isDescriptionComment(line) || isEmptyLine(line)) return line

    const groups = parseGroupTags(line)
    if (!groups.includes(groupName)) return line

    // Check if group is currently all active
    const groupLines = lines.value.filter(l => {
      const tags = parseGroupTags(l)
      return tags.includes(groupName) && !isDescriptionComment(l) && !isEmptyLine(l)
    })

    const allActive = groupLines.every(l => !l.trim().startsWith('//'))

    // Toggle: if all active, deactivate; otherwise activate
    if (allActive) {
      return line.trim().startsWith('//') ? line : '// ' + line
    } else {
      return line.replace(/^\/\/\s*/, '')
    }
  })

  textContent.value = newLines.join('\n')
  updateWidgetValue()
}

function handleToggleAll(activate: boolean) {
  const newLines = lines.value.map(line => {
    if (isDescriptionComment(line) || isEmptyLine(line)) return line

    if (activate) {
      return line.replace(/^\/\/\s*/, '')
    } else {
      return line.trim().startsWith('//') ? line : '// ' + line
    }
  })

  textContent.value = newLines.join('\n')
  updateWidgetValue()
}

function updateWidgetValue() {
  const value: WidgetValue = {
    text: textContent.value,
    separator: separator.value,
    prefix: prefix.value,
    add_newline: addNewline.value,
    separator_newline: separatorNewline.value,
    trailing_separator: trailingSeparator.value
  }

  props.widget.value = value

  console.log('[PromptPaletteWidget] updateWidgetValue called', {
    textContentFull: textContent.value,
    textFirst50: textContent.value.substring(0, 50),
    separator: value.separator,
    lines: textContent.value.split('\n').map((l, i) => `${i}: ${l.substring(0, 30)}`)
  })

  // Trigger callback to sync with backend widgets
  if (props.widget.callback) {
    props.widget.callback()
  }

  node.setDirtyCanvas(true, true)
}

// Lifecycle
onMounted(() => {
  // Initialize from widget value if available
  if (props.widget.value) {
    const val = props.widget.value as WidgetValue
    textContent.value = val.text || ''
    separator.value = val.separator || ', '
    prefix.value = val.prefix || ''
    addNewline.value = val.add_newline || false
    separatorNewline.value = val.separator_newline || false
    trailingSeparator.value = val.trailing_separator || false
  }

  // Set up serializeValue to return current Vue state
  props.widget.serializeValue = async () => {
    const value = {
      text: textContent.value,
      separator: separator.value,
      prefix: prefix.value,
      add_newline: addNewline.value,
      separator_newline: separatorNewline.value,
      trailing_separator: trailingSeparator.value,
      _cache_bust: Date.now()  // Add timestamp to prevent execution caching
    }

    console.log('[PromptPaletteWidget] serializeValue called from Vue component', {
      text: value.text.substring(0, 50),
      separator: value.separator,
      lines: textContent.value.split('\n').length,
      _cache_bust: value._cache_bust
    })

    return value
  }

  console.log('[PromptPaletteWidget] Component mounted', {
    text: textContent.value,
    separator: separator.value,
    editMode: editMode.value,
    showPreview: showPreview.value,
    lines: lines.value.length,
    widgetValue: props.widget.value
  })

  // Force update widget value with current state
  updateWidgetValue()

  // Debug: Check if DOM is rendered
  setTimeout(() => {
    const widgetEl = document.querySelector('.prompt-palette-widget')
    console.log('[PromptPaletteWidget] DOM check:', {
      exists: !!widgetEl,
      innerHTML: widgetEl?.innerHTML.substring(0, 200)
    })
  }, 100)
})
</script>

<style scoped>
.prompt-palette-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 300px;
  background: var(--comfy-menu-bg, #1e1e1e);
  color: var(--input-text, #ddd);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border: 3px solid #ff0000 !important;
  box-sizing: border-box;
  padding: 8px;
}

.toolbar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
}

.mode-toggle-btn,
.preview-toggle-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #2a2a2a);
  color: var(--input-text, #ddd);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: all 0.2s;
}

.mode-toggle-btn:hover,
.preview-toggle-btn:hover {
  background: var(--comfy-input-hover-bg, #353535);
}

.edit-mode {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.text-editor {
  width: 100%;
  min-height: 200px;
  padding: 8px;
  border: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
  color: var(--input-text, #ddd);
  font-family: monospace;
  font-size: 13px;
  resize: vertical;
  border-radius: 4px;
}

.text-editor:focus {
  outline: none;
  border-color: var(--highlight-color, #4a9eff);
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.option-label span {
  font-weight: 500;
  color: var(--descrip-text, #aaa);
}

.separator-input,
.prefix-input {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
  color: var(--input-text, #ddd);
  border-radius: 3px;
  font-size: 12px;
}

.separator-input:focus,
.prefix-input:focus {
  outline: none;
  border-color: var(--highlight-color, #4a9eff);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.display-mode {
  display: flex;
  flex-direction: column;
  max-height: 400px;
  overflow-y: auto;
}

.phrases-list {
  flex: 1;
  overflow-y: auto;
}

.description-comment {
  padding: 6px 12px;
  font-style: italic;
  color: var(--descrip-text, #999);
  font-size: 12px;
  background: var(--comfy-input-bg, #222);
  border-bottom: 1px solid var(--border-color, #333);
}
</style>
