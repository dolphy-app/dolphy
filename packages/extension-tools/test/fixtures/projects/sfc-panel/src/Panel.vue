<script setup lang="ts">
import { ref } from 'vue';
import Badge from './Badge.vue';

const count = ref<number>(0);
</script>

<template>
  <v-card class="panel">
    <v-alert type="info">Hello from a component</v-alert>
    <v-btn v-ripple color="primary" @click="count += 1">
      Clicked {{ count }}
    </v-btn>
    <Badge :count="count" />
  </v-card>
</template>

<style>
.panel {
  padding: 8px;
}
</style>

<style scoped>
.panel .note {
  color: red;
}
</style>
