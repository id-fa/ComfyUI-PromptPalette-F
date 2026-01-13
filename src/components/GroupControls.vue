<template>
  <div class="group-controls" v-if="groups.length > 0">
    <div class="global-controls">
      <button @click="toggleAll(true)" class="group-btn global-btn all-btn">
        [all]
      </button>
      <button @click="toggleAll(false)" class="group-btn global-btn off-btn">
        [off]
      </button>
    </div>
    <div class="group-buttons">
      <button
        v-for="group in groups"
        :key="group.name"
        @click="toggleGroup(group.name)"
        :class="['group-btn', getGroupClass(group.name)]"
      >
        [{{ group.name }}]
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  lines: string[]
}

interface GroupInfo {
  name: string
  activeCount: number
  totalCount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  toggleGroup: [groupName: string]
  toggleAll: [activate: boolean]
}>()

// Parse group tags from a line
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

// Get all unique groups with their status
const groups = computed<GroupInfo[]>(() => {
  const groupMap = new Map<string, { active: number; total: number }>()

  props.lines.forEach(line => {
    if (line.trim().startsWith('#') || line.trim() === '') return

    const tags = parseGroupTags(line)
    const isActive = !line.trim().startsWith('//')

    tags.forEach(tag => {
      if (!groupMap.has(tag)) {
        groupMap.set(tag, { active: 0, total: 0 })
      }
      const stats = groupMap.get(tag)!
      stats.total++
      if (isActive) stats.active++
    })
  })

  return Array.from(groupMap.entries()).map(([name, stats]) => ({
    name,
    activeCount: stats.active,
    totalCount: stats.total
  }))
})

function getGroupClass(groupName: string): string {
  const group = groups.value.find(g => g.name === groupName)
  if (!group) return ''

  if (group.activeCount === 0) return 'group-off'
  if (group.activeCount === group.totalCount) return 'group-all'
  return 'group-partial'
}

function toggleGroup(groupName: string) {
  emit('toggleGroup', groupName)
}

function toggleAll(activate: boolean) {
  emit('toggleAll', activate)
}
</script>

<style scoped>
.group-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-bottom: 2px solid var(--border-color, #444);
  background: var(--comfy-menu-bg, #1a1a1a);
}

.global-controls {
  display: flex;
  gap: 8px;
}

.group-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.group-btn {
  padding: 4px 10px;
  border: 1px solid var(--border-color, #444);
  background: var(--comfy-input-bg, #222);
  color: var(--input-text, #ddd);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  transition: all 0.2s;
}

.group-btn:hover {
  background: var(--comfy-input-hover-bg, #333);
  transform: translateY(-1px);
}

.group-btn:active {
  transform: translateY(0);
}

/* Global buttons */
.global-btn {
  font-weight: bold;
  padding: 4px 12px;
}

.all-btn {
  background: #2d5016;
  border-color: #4a8020;
  color: #a8f070;
}

.all-btn:hover {
  background: #3d6020;
}

.off-btn {
  background: #5d1616;
  border-color: #8a2020;
  color: #f07070;
}

.off-btn:hover {
  background: #6d2020;
}

/* Group status colors */
.group-all {
  background: #2d5016;
  border-color: #4a8020;
  color: #a8f070;
}

.group-partial {
  background: #5d4a16;
  border-color: #8a7020;
  color: #f0d870;
}

.group-off {
  background: #3d3d3d;
  border-color: #5a5a5a;
  color: #999;
}
</style>
