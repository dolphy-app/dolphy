<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { NoticeSnackbar } from '@/features/extension-commands';
import { useCommandRegistry } from '@/shared/lib/command-registry.ts';
import { installShortcutDispatcher } from '@/shared/lib/shortcut-dispatcher.ts';
import { CommandPalette, useCommandPalette } from '@/widgets/command-palette';

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
    <router-view />
    <!-- палитра и уведомления живут здесь, чтобы работать и на /session, и на /placement -->
    <CommandPalette />
    <NoticeSnackbar />
  </v-app>
</template>
