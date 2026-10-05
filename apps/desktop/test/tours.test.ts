import { describe, expect, it } from 'vitest';
import { messages } from '@/features/onboarding-tour/i18n';
import { TOURS, targetSelector } from '@/features/onboarding-tour/lib/tours.ts';

type Catalog = Record<string, Record<string, { title: string; text: string }>>;

describe('tour definitions', () => {
  it.each(['ru', 'en'] as const)(
    'every step has a title and a text in %s',
    (locale) => {
      const catalog = messages[locale].tour as unknown as Catalog;
      for (const tour of TOURS) {
        for (const step of tour.steps) {
          const entry = catalog[tour.id]?.[step.id];
          expect(entry?.title, `${tour.id}.${step.id}.title`).toBeTruthy();
          expect(entry?.text, `${tour.id}.${step.id}.text`).toBeTruthy();
        }
      }
    },
  );

  it('step ids are unique within a tour and every step has an icon', () => {
    for (const tour of TOURS) {
      const ids = tour.steps.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of tour.steps) expect(step.icon).toMatch(/^mdi-/);
    }
  });

  it('targets are selected by the data-tour attribute', () => {
    expect(targetSelector('nav-daily-plan')).toBe(
      '[data-tour="nav-daily-plan"]',
    );
  });
});
