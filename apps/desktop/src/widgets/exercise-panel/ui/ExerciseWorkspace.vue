<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { clampWidth } from '../lib/material-layout.ts';
import { useMaterialLayout } from '../model/use-material-layout.ts';
import MaterialPanel from './MaterialPanel.vue';
import MaterialSplitter from './MaterialSplitter.vue';

defineProps<{
  /** Markdown материала урока; `null` — панели материала нет. */
  material: string | null;
  courseName: string;
}>();

const { t } = useI18n();
const layout = useMaterialLayout();
const { state } = layout;

const resize = (width: number) =>
  layout.preview(clampWidth(width, window.innerWidth));
</script>

<template>
  <div class="workspace">
    <template v-if="material">
      <MaterialPanel
        v-if="!state.collapsed"
        :material="material"
        :course-name="courseName"
        :width="state.width"
        @collapse="layout.setCollapsed(true)"
      />
      <MaterialSplitter
        v-if="!state.collapsed"
        @resize="resize"
        @commit="layout.commit()"
        @commit-soon="layout.commitSoon()"
        @reset="layout.reset()"
      />
      <div v-else class="rail">
        <v-btn
          size="small"
          variant="text"
          icon="mdi-book-open-variant-outline"
          :aria-label="t('exercisePanel.panel.show')"
          :title="t('exercisePanel.panel.show')"
          aria-expanded="false"
          @click="layout.setCollapsed(false)"
        />
      </div>
    </template>

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

/* скрытая панель: узкая рейка, чтобы вернуть теорию в один щелчок */
.rail {
  display: flex;
  flex: 0 0 3rem;
  justify-content: center;
  padding-top: 1rem;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.content-inner {
  max-width: 45rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}
</style>
