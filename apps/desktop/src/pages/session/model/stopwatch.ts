import { computed, onScopeDispose, ref } from 'vue';

const TICK_MS = 250;
const MS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;

const pad = (value: number) => String(value).padStart(2, '0');

export const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.floor(elapsedMs / MS_IN_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_IN_MINUTE);
  return `${pad(minutes)}:${pad(totalSeconds % SECONDS_IN_MINUTE)}`;
};

/** Секундомер сессии: время на паузе не копится. */
export const useStopwatch = () => {
  const elapsedMs = ref(0);
  const running = ref(true);
  let lastTickAt = performance.now();

  const timer = setInterval(() => {
    const now = performance.now();
    if (running.value) elapsedMs.value += now - lastTickAt;
    lastTickAt = now;
  }, TICK_MS);
  onScopeDispose(() => clearInterval(timer));

  return {
    running,
    elapsedMs,
    formatted: computed(() => formatElapsed(elapsedMs.value)),
  };
};
