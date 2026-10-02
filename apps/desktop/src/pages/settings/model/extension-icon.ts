import { computed, ref } from 'vue';

/**
 * Показывать ли значок расширения. Значок приходит как `data:`-URI из индекса
 * каталога, который окно не проверяет: если браузер не смог его разобрать,
 * значок скрывается совсем (вид как у расширения без значка), а не рисуется
 * значком «битой картинки». Запомнен именно адрес, не флаг: другой адрес
 * (обновление записи каталога) снова показывается.
 */
export const useExtensionIcon = (src: () => string | null) => {
  const failed = ref<string | null>(null);
  const visible = computed(() => {
    const current = src();
    return current !== null && failed.value !== current;
  });
  const markFailed = () => {
    failed.value = src();
  };
  return { visible, markFailed };
};
