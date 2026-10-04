<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { NoticeSnackbar } from '@/features/extension-commands';
import { useCommandRegistry } from '@/shared/lib/command-registry.ts';
import { installShortcutDispatcher } from '@/shared/lib/shortcut-dispatcher.ts';
import { CommandPalette, useCommandPalette } from '@/widgets/command-palette';
import SafeModeBanner from './layouts/SafeModeBanner.vue';

const registry = useCommandRegistry();
const palette = useCommandPalette();

// единственный обработчик клавиш окна: Ctrl/⌘+K и сочетания команд приложения
let stopShortcuts: (() => void) | undefined;
onMounted(() => {
  stopShortcuts = installShortcutDispatcher(document, {
    registry,
    openPalette: () => palette.open(),
  });
});
onBeforeUnmount(() => stopShortcuts?.());
</script>

<template>
  <v-app>
    <!-- безопасный режим виден в каждом окне, на любой странице -->
    <SafeModeBanner />
    <router-view />
    <!-- палитра и уведомления живут здесь, чтобы работать и на /session, и на /placement -->
    <CommandPalette />
    <NoticeSnackbar />
  </v-app>
</template>
