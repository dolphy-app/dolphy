<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  createKeybindingDispatcher,
  useKeybindings,
} from '@/features/keybindings';
import { NoticeSnackbar } from '@/features/extension-commands';
import { ROUTE } from '@/shared/config/routes.ts';
import { useCommandRegistry } from '@/shared/lib/command-registry.ts';
import { pageOfRoute, useContextKeys } from '@/shared/lib/context-keys.ts';
import { CommandPalette, useCommandPalette } from '@/widgets/command-palette';
import ChordStatus from './layouts/ChordStatus.vue';
import SafeModeBanner from './layouts/SafeModeBanner.vue';

const contextKeys = useContextKeys();
const palette = useCommandPalette();
const route = useRoute();

// контекстные ключи `when`: раздел, сессия, палитра; `inputFocus` и `modalOpen` читаются при нажатии
watch(
  () => route.name,
  (name) => {
    contextKeys.page.value = pageOfRoute(name);
    contextKeys.inSession.value = name === ROUTE.session;
  },
  { immediate: true },
);
watch(
  palette.isOpen,
  (open) => {
    contextKeys.paletteOpen.value = open;
  },
  { immediate: true },
);

// единственный обработчик клавиш окна: привязки команд приложения и расширений (в том числе палитра)
const dispatcher = createKeybindingDispatcher({
  registry: useCommandRegistry(),
  keybindings: useKeybindings(),
  contextKeys,
});
let stopShortcuts: (() => void) | undefined;
onMounted(() => {
  stopShortcuts = dispatcher.install(document);
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
    <!-- ожидание второй клавиши цепочки: видно и озвучивается скринридеру -->
    <ChordStatus :pending="dispatcher.pending.value" />
  </v-app>
</template>
