<script setup lang="ts">
import { provideExtensionContext } from '@/shared/lib/extension-context.ts';

// id фиксируется при создании: смена расширения пересоздаёт область (`:key`)
const props = defineProps<{ extensionId: string }>();

provideExtensionContext(props.extensionId);
</script>

<template>
  <slot />
</template>
