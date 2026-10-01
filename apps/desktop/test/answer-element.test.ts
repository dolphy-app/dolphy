// @vitest-environment happy-dom
import { shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  ExerciseTaskDto,
  ExerciseTypeContributionDto,
} from '@dolphy-app/engine-contract';
import { useReloadRequired } from '@/pages/settings/model/reload-required.ts';
import {
  ensureAnswerElement,
  staleAnswerElements,
} from '@/shared/lib/answer-element.ts';
import type { ContributionsRef } from '@/shared/api/engine/contributions.ts';

let counter = 0;
/** Тег уникален на тест: определённый элемент из окна не убрать. */
const nextTag = () => `x-answer-${(counter += 1)}`;

const task = (element: string, revision: string, isolated = false) =>
  ({
    type: 'acme.t',
    timeoutMs: 1000,
    element,
    rendererUrl: 'dolphy-ext://acme.t/view.mjs',
    isolated,
    origin: 'user',
    revision,
  }) satisfies ExerciseTaskDto;

const typeOf = (
  element: string,
  revision: string,
  isolated = false,
): ExerciseTypeContributionDto => ({
  type: 'acme.t',
  extensionId: 'acme.t',
  element,
  rendererUrl: 'dolphy-ext://acme.t/view.mjs',
  isolated,
  origin: 'user',
  revision,
});

describe('ensureAnswerElement', () => {
  it('imports the module by a revision-qualified address and defines the tag once', async () => {
    const element = nextTag();
    const urls: string[] = [];
    const load = async (url: string) => {
      urls.push(url);
      customElements.define(element, class extends HTMLElement {});
    };
    await ensureAnswerElement(task(element, 'rev-1'), load);
    expect(urls).toEqual(['dolphy-ext://acme.t/view.mjs?v=rev-1']);
    await ensureAnswerElement(task(element, 'rev-2'), load);
    expect(urls).toHaveLength(1);
    expect(customElements.get(element)).toBeDefined();
  });

  it('concurrent calls for one tag wait for a single import', async () => {
    const element = nextTag();
    let imports = 0;
    const load = async () => {
      imports += 1;
      await Promise.resolve();
      customElements.define(element, class extends HTMLElement {});
    };
    await Promise.all([
      ensureAnswerElement(task(element, 'rev-1'), load),
      ensureAnswerElement(task(element, 'rev-2'), load),
    ]);
    expect(imports).toBe(1);
  });
});

describe('staleAnswerElements (R7)', () => {
  it('flags a tag defined from older files once the extension is updated', async () => {
    const element = nextTag();
    await ensureAnswerElement(task(element, 'rev-1'), async () => {
      customElements.define(element, class extends HTMLElement {});
    });
    expect(staleAnswerElements([typeOf(element, 'rev-1')])).toEqual([]);
    expect(staleAnswerElements([typeOf(element, 'rev-2')])).toEqual([element]);
  });

  it('does not flag tags the window has not defined', () => {
    expect(staleAnswerElements([typeOf(nextTag(), 'rev-2')])).toEqual([]);
  });

  it('does not flag isolated types: each mount gets a fresh frame', async () => {
    const element = nextTag();
    await ensureAnswerElement(task(element, 'rev-1'), async () => {
      customElements.define(element, class extends HTMLElement {});
    });
    expect(staleAnswerElements([typeOf(element, 'rev-2', true)])).toEqual([]);
  });

  it('does not flag bundled elements (revision stays empty)', async () => {
    const element = nextTag();
    await ensureAnswerElement(task(element, ''), async () => {
      customElements.define(element, class extends HTMLElement {});
    });
    expect(staleAnswerElements([typeOf(element, '')])).toEqual([]);
  });

  it('the banner flag follows the contributions and clears when the old files return', async () => {
    const element = nextTag();
    await ensureAnswerElement(task(element, 'rev-1'), async () => {
      customElements.define(element, class extends HTMLElement {});
    });
    const contributions = shallowRef({
      generation: 0,
      exerciseTypes: [typeOf(element, 'rev-1')],
      themes: [],
      markdownRenderers: [],
      gradePolicies: [],
    });
    const required = useReloadRequired(contributions as ContributionsRef);
    expect(required.value).toBe(false);
    contributions.value = {
      ...contributions.value,
      exerciseTypes: [typeOf(element, 'rev-2')],
    };
    expect(required.value).toBe(true);
    contributions.value = { ...contributions.value, exerciseTypes: [] };
    expect(required.value).toBe(false);
  });
});
