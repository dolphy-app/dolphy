import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useExtensionIcon } from '@/pages/settings/model/extension-icon.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';

describe('значок расширения', () => {
  it('без значка ничего не показывается', () => {
    const src = ref<string | null>(null);
    expect(useExtensionIcon(() => src.value).visible.value).toBe(false);
  });

  it('значок, который браузер не смог разобрать, скрывается, а не рисуется «битой картинкой»', () => {
    const src = ref<string | null>(PNG);
    const icon = useExtensionIcon(() => src.value);
    expect(icon.visible.value).toBe(true);
    icon.markFailed();
    expect(icon.visible.value).toBe(false);
  });

  it('другой адрес показывается снова, прежний нечитаемый остаётся скрытым', () => {
    const src = ref<string | null>(PNG);
    const icon = useExtensionIcon(() => src.value);
    icon.markFailed();
    src.value = WEBP;
    expect(icon.visible.value).toBe(true);
    src.value = PNG;
    expect(icon.visible.value).toBe(false);
  });
});
