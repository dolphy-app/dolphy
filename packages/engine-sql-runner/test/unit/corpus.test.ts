/**
 * T-43: 30 проверок × (эталон, альтернативные ответы, неверные ответы) на
 * каждом доступном драйвере. Ожидаемые CSV написаны вручную, не получены
 * прогоном эталонного SQL.
 */
import { describe, expect, it } from 'vitest';
import { runCheck } from '../../src/check.ts';
import { CHECKS, EMP_FIXTURE, toRequest } from '../helpers/checks.ts';
import { AVAILABLE_DRIVERS } from '../helpers/capabilities.ts';

describe('корпус', () => {
  it('30 проверок, у каждой ожидаемый CSV', () => {
    expect(CHECKS).toHaveLength(30);
    expect(new Set(CHECKS.map(({ id }) => id)).size).toBe(30);
    expect(EMP_FIXTURE).toContain('CREATE TABLE emp');
  });
});

describe.each(AVAILABLE_DRIVERS)('проверки на %s', (driver) => {
  for (const check of CHECKS) {
    it(`${check.id}: эталон проходит`, () => {
      expect(runCheck(toRequest(check, check.solution), driver)).toMatchObject({
        status: 'passed',
        code: 'ok',
      });
    });
    for (const alt of check.alt ?? []) {
      it(`${check.id}: верная альтернатива проходит: ${alt.slice(0, 48)}`, () => {
        expect(runCheck(toRequest(check, alt), driver).status).toBe('passed');
      });
    }
    for (const wrong of check.wrong ?? []) {
      it(`${check.id}: неверный ответ — failed/mismatch: ${wrong.slice(0, 48)}`, () => {
        expect(runCheck(toRequest(check, wrong), driver)).toMatchObject({
          status: 'failed',
          code: 'mismatch',
        });
      });
    }
  }

  it('допуск: 0.1+0.2 vs 0.3 проходит по умолчанию и падает при numericTolerance 0', () => {
    const check = CHECKS.find(({ id }) => id === 'select-float-tolerance');
    if (check === undefined) throw new Error('нет проверки');
    const request = toRequest(check, check.solution);
    expect(runCheck(request, driver).status).toBe('passed');
    expect(
      runCheck({ ...request, compare: { numericTolerance: 0 } }, driver),
    ).toMatchObject({ status: 'failed', code: 'mismatch' });
  });

  it('число утверждений на драйвер: 30 эталонов + 6 альтернатив + 18 неверных', () => {
    const alt = CHECKS.reduce((n, { alt: a }) => n + (a?.length ?? 0), 0);
    const wrong = CHECKS.reduce((n, { wrong: w }) => n + (w?.length ?? 0), 0);
    expect([30, alt, wrong]).toEqual([30, 6, 18]);
  });
});
