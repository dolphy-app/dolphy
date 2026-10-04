<script setup lang="ts">
import MaterialPanel from './MaterialPanel.vue';

defineProps<{
  /** Markdown материала урока; `null` — панели материала нет. */
  material: string | null;
  courseName: string;
}>();
</script>

<template>
  <div class="workspace">
    <MaterialPanel
      v-if="material"
      :material="material"
      :course-name="courseName"
    />

    <div class="content">
      <div class="content-inner">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
}

.content-inner {
  max-width: 45rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}
</style>
