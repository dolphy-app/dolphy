<script setup lang="ts">
import { useTheme } from 'vuetify';

const theme = useTheme();
</script>

<template>
  <div data-testid="sfc-card">
    <p data-role="theme">Тема: {{ theme.name.value }}</p>
    <v-alert type="success" density="compact" data-role="alert">
      Вставка на SFC
    </v-alert>
    <v-btn data-role="button">Кнопка вставки</v-btn>
    <p class="sfc-note" data-role="note">Заметка вставки</p>
  </div>
</template>
