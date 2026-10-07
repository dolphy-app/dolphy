<script setup lang="ts">
import { ref } from 'vue';
import { useTheme } from 'vuetify';

const clicks = ref(0);
const theme = useTheme();
</script>

<template>
  <div class="sfc-panel" data-testid="sfc-panel">
    <p data-role="theme">Тема: {{ theme.name.value }}</p>
    <v-alert type="info" density="compact" data-role="alert">
      Панель на SFC
    </v-alert>
    <v-btn color="primary" data-role="button" @click="clicks += 1">
      Нажато {{ clicks }}
    </v-btn>
    <p class="sfc-note" data-role="note">Заметка панели</p>
  </div>
</template>

<style>
.sfc-panel {
  background-color: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
</style>

<style scoped>
.sfc-note {
  color: rgb(255, 0, 0);
}
</style>
