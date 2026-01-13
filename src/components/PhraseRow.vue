<template>
  <div class="phrase-row" :class="{ 'commented': isCommented }">
    <input
      type="checkbox"
      :checked="!isCommented"
      @change="toggleComment"
      class="phrase-checkbox"
    />
    <span class="phrase-text" @click="toggleComment">
      {{ displayText }}
    </span>
    <div class="weight-controls" v-if="hasWeight">
      <button @click="decrementWeight" class="weight-btn">-</button>
      <span class="weight-value">{{ currentWeight.toFixed(1) }}</span>
      <button @click="incrementWeight" class="weight-btn">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  line: string
  index: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  update: [index: number, newLine: string]
}>()

const isCommented = computed(() => {
  return props.line.trim().startsWith('//')
})

const displayText = computed(() => {
  let text = props.line
  if (isCommented.value) {
    text = text.replace(/^\/\/\s*/, '')
  }
  // Remove group tags for display
  text = text.replace(/\[[\w-]+\]/g, '').trim()
  return text
})

const weightRegex = /\(([^:]+):([\d.]+)\)/

const hasWeight = computed(() => {
  const cleanLine = props.line.replace(/^\/\/\s*/, '')
  return weightRegex.test(cleanLine)
})

const currentWeight = computed(() => {
  const cleanLine = props.line.replace(/^\/\/\s*/, '')
  const match = cleanLine.match(weightRegex)
  return match ? parseFloat(match[2]) : 1.0
})

function toggleComment() {
  console.log('[PhraseRow] toggleComment START', {
    propsLine: props.line,
    isCommented: isCommented.value,
    lineStartsWith: props.line.trim().startsWith('//'),
    lineTrimmed: props.line.trim()
  })

  let newLine: string
  if (isCommented.value) {
    // Currently commented - remove comment to activate
    newLine = props.line.replace(/^\/\/\s*/, '')
    console.log('[PhraseRow] Removing comment', {
      before: props.line,
      after: newLine
    })
  } else {
    // Currently active - add comment to deactivate
    newLine = '// ' + props.line
    console.log('[PhraseRow] Adding comment', {
      before: props.line,
      after: newLine
    })
  }

  console.log('[PhraseRow] toggleComment END', {
    wasCommented: isCommented.value,
    oldLine: props.line.substring(0, 30),
    newLine: newLine.substring(0, 30),
    willEmit: true
  })

  emit('update', props.index, newLine)
}

function incrementWeight() {
  updateWeight(currentWeight.value + 0.1)
}

function decrementWeight() {
  updateWeight(currentWeight.value - 0.1)
}

function updateWeight(newWeight: number) {
  newWeight = Math.max(0.1, Math.min(2.0, newWeight))

  const cleanLine = props.line.replace(/^\/\/\s*/, '')
  const match = cleanLine.match(weightRegex)

  if (match) {
    const newLine = cleanLine.replace(weightRegex, `(${match[1]}:${newWeight.toFixed(1)})`)
    const finalLine = isCommented.value ? '// ' + newLine : newLine
    emit('update', props.index, finalLine)
  }
}
</script>

<style scoped>
.phrase-row {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 8px;
  border-bottom: 1px solid var(--border-color, #444);
}

.phrase-row.commented {
  opacity: 0.6;
}

.phrase-checkbox {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.phrase-text {
  flex: 1;
  cursor: pointer;
  user-select: none;
}

.phrase-row.commented .phrase-text {
  text-decoration: line-through;
  color: var(--disabled-text-color, #888);
}

.weight-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.weight-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
  color: var(--input-text, #ddd);
  cursor: pointer;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
}

.weight-btn:hover {
  background: var(--comfy-input-hover-bg, #333);
}

.weight-btn:active {
  background: var(--comfy-input-active-bg, #444);
}

.weight-value {
  min-width: 30px;
  text-align: center;
  font-size: 12px;
  font-weight: bold;
  color: var(--highlight-color, #4a9eff);
}
</style>
