import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountDataTable, mountTable } from '../src/vuetify/table.ts';

const columns = [
  { key: 'name', title: 'Name' },
  { key: 'score', title: 'Score', align: 'end' as const },
];

const rows = [
  { name: 'Alpha', score: 3 },
  { name: 'Beta', score: 1 },
  { name: 'Gamma', score: 2 },
];

const host = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

const flush = async (): Promise<void> => {
  await nextTick();
  await nextTick();
};

const bodyNames = (container: ParentNode): string[] =>
  [...container.querySelectorAll('tbody tr')].map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  );

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.lang = 'en';
});

describe('table', () => {
  it('renders a named table with headers and cells and follows update()', async () => {
    const container = host();
    const mounted = mountTable(container, {
      columns,
      rows: [{ name: 'Alpha', score: null }],
      caption: 'Scores',
    });
    await flush();
    const table = container.querySelector('table');
    expect(table?.getAttribute('aria-label')).toBe('Scores');
    expect(
      [...container.querySelectorAll('th')].map((th) => th.textContent),
    ).toEqual(['Name', 'Score']);
    expect(
      [...container.querySelectorAll('tbody td')].map((td) => td.textContent),
    ).toEqual(['Alpha', '']);

    mounted.update({ rows: [{ name: 'Beta', score: true }] });
    await flush();
    expect(
      [...container.querySelectorAll('tbody td')].map((td) => td.textContent),
    ).toEqual(['Beta', 'true']);

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });
});

describe('data table', () => {
  it('shows rows, filters by search, sorts and reports the click', async () => {
    const container = host();
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    const mounted = mountDataTable(container, {
      columns,
      rows,
      caption: 'Scores',
      itemsPerPage: 10,
      onSort,
      onRowClick,
    });
    await flush();
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe(
      'Scores',
    );
    expect(bodyNames(container)).toEqual(['Alpha', 'Beta', 'Gamma']);

    mounted.update({ search: 'amm' });
    await flush();
    expect(bodyNames(container)).toEqual(['Gamma']);
    mounted.update({ search: '' });
    await flush();

    mounted.update({ sortBy: [{ key: 'score', order: 'asc' }] });
    await flush();
    expect(bodyNames(container)).toEqual(['Beta', 'Gamma', 'Alpha']);

    const headers = [...container.querySelectorAll<HTMLElement>('th')];
    headers[0]?.click();
    await flush();
    expect(onSort).toHaveBeenCalledWith([{ key: 'name', order: 'asc' }]);

    container.querySelectorAll<HTMLElement>('tbody tr')[0]?.click();
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith({
      name: 'Beta',
      score: 1,
    });

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('uses the override for the empty text', async () => {
    const container = host();
    mountDataTable(container, { columns, rows: [], emptyText: 'Nothing' });
    await flush();
    expect(container.textContent).toContain('Nothing');
  });

  it('speaks English by default, Russian for <html lang="ru"> and follows a switch', async () => {
    const english = host();
    mountDataTable(english, { columns, rows: [] });
    await flush();
    expect(english.textContent).toContain('No data available');
    expect(english.textContent).toContain('Items per page');
    english.remove();

    document.documentElement.lang = 'ru';
    const russian = host();
    const mounted = mountDataTable(russian, { columns, rows: [] });
    await flush();
    expect(russian.textContent).toContain('Отсутствуют данные');
    expect(russian.textContent).toContain('Записей на странице');

    document.documentElement.lang = 'en';
    await flush();
    expect(russian.textContent).toContain('No data available');
    mounted.destroy();
  });

  it('shows the page range in the frame language', async () => {
    document.documentElement.lang = 'ru';
    const container = host();
    mountDataTable(container, { columns, rows, itemsPerPage: 2 });
    await flush();
    expect(container.textContent).toContain('1-2 из 3');
  });
});
