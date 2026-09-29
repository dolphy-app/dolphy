<script setup lang="ts">
defineProps<{ kind: 'update' | 'failed'; message: string }>();
</script>

<template>
  <main class="startup-error">
    <h1 v-if="kind === 'update'">Обновите приложение</h1>
    <h1 v-else>Не удалось подключиться к движку</h1>
    <p v-if="kind === 'update'">
      Версия интерфейса не совпадает с версией движка обучения.
    </p>
    <p>
      <code>{{ message }}</code>
    </p>
  </main>
</template>
