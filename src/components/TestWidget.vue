<template>
  <div style="padding: 10px; background: #2a2a2a; color: white; border: 2px solid #4a9eff;">
    <h3>🎉 Vue Widget is Working!</h3>
    <p>Widget name: {{ widget?.name }}</p>
    <p>Node type: {{ node?.type }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{
  widget: any
}>()

const node = props.widget?.node

onMounted(() => {
  console.log('[TestWidget] Component mounted!', {
    widget: props.widget,
    node: node
  })
})
</script>
