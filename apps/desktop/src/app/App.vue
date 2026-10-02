<script setup lang="ts">
import { NoticeSnackbar } from '@/features/extension-commands';
import { CommandPalette } from '@/widgets/command-palette';
</script>

<template>
  <v-app>
    <router-view />
    <!-- палитра и уведомления живут здесь, чтобы работать и на /session, и на /placement -->
    <CommandPalette />
    <NoticeSnackbar />
  </v-app>
</template>
