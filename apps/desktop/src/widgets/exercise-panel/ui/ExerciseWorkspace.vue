<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import MarkdownView from '@/shared/ui/MarkdownView.vue';

defineProps<{
  /** Markdown материала урока; `null` — панели материала нет. */
  material: string | null;
  courseName: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="workspace">
    <aside v-if="material" class="material pa-6">
      <p class="overline-label mb-4">
        {{ t('exercisePanel.material', { course: courseName }) }}
      </p>
      <MarkdownView :source="material" class="text-body-medium" />
    </aside>

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

.material {
  flex: 0 0 22rem;
  overflow-y: auto;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
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
