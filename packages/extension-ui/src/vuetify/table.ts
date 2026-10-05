/** Tables: `VTable` (static) and `VDataTable` (sorting, search, paging) of Vuetify. */
import { h } from 'vue';
import type { Component, FunctionalComponent } from 'vue';
import { VDataTable } from 'vuetify/components/VDataTable';
import { VTable } from 'vuetify/components/VTable';
import { mountComponent } from './mount.ts';
import type { Mounted } from './mount.ts';

/** A cell value. */
export type TableCell = string | number | boolean | null;

/** A table row: cells by column key. */
export type TableRow = Record<string, TableCell>;

/** A table column. */
export interface TableColumn {
  /** The key of the cell in a row. */
  key: string;
  /** The text of the column header. */
  title: string;
  align?: 'start' | 'center' | 'end';
}

export type TableDensity = 'default' | 'comfortable' | 'compact';

export interface TableProps {
  columns: TableColumn[];
  rows: TableRow[];
  /** The accessible name of the table (`aria-label`). */
  caption?: string;
  density?: TableDensity;
  /** Keep the header visible while the body scrolls; needs a `height`. */
  fixedHeader?: boolean;
  /** CSS height of the scrolling area, for example `'300px'`. */
  height?: string;
}

/** The sorting of a data table: one entry per sorted column, in priority order. */
export interface TableSort {
  key: string;
  order: 'asc' | 'desc';
}

export interface DataTableProps {
  columns: TableColumn[];
  rows: TableRow[];
  /** The accessible name of the table (`aria-label`). */
  caption?: string;
  density?: TableDensity;
  /** Filters the rows by a substring of any cell. */
  search?: string;
  sortBy?: TableSort[];
  /** Rows per page; `-1` shows all of them. */
  itemsPerPage?: number;
  loading?: boolean;
  /** Replaces the built-in "no data" text, which follows the frame language. */
  emptyText?: string;
  onSort?: (sortBy: TableSort[]) => void;
  onRowClick?: (row: TableRow) => void;
}

/** Drops `undefined` values: the Vuetify props do not accept them as is. */
const defined = (props: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  );

const cellText = (cell: TableCell | undefined): string =>
  cell === null || cell === undefined ? '' : String(cell);

const TableView: FunctionalComponent<TableProps> = (props) =>
  h(
    VTable,
    defined({
      'aria-label': props.caption,
      density: props.density,
      fixedHeader: props.fixedHeader,
      height: props.height,
    }),
    {
      default: () => [
        h(
          'thead',
          h(
            'tr',
            props.columns.map((column) =>
              h(
                'th',
                {
                  key: column.key,
                  scope: 'col',
                  style: { textAlign: column.align ?? 'start' },
                },
                column.title,
              ),
            ),
          ),
        ),
        h(
          'tbody',
          props.rows.map((row, index) =>
            h(
              'tr',
              { key: index },
              props.columns.map((column) =>
                h(
                  'td',
                  {
                    key: column.key,
                    style: { textAlign: column.align ?? 'start' },
                  },
                  cellText(row[column.key]),
                ),
              ),
            ),
          ),
        ),
      ],
    },
  );
TableView.props = [
  'columns',
  'rows',
  'caption',
  'density',
  'fixedHeader',
  'height',
];

const DataTableView: FunctionalComponent<DataTableProps> = (props) =>
  h(
    // the generic typing of `VDataTable` does not fit `h()`
    VDataTable as Component,
    defined({
      'aria-label': props.caption,
      headers: props.columns.map((column) => ({
        key: column.key,
        title: column.title,
        align: column.align,
      })),
      items: props.rows,
      density: props.density,
      search: props.search,
      sortBy: props.sortBy,
      itemsPerPage: props.itemsPerPage,
      loading: props.loading,
      // `undefined` keeps the localized default
      noDataText: props.emptyText,
      'onUpdate:sortBy': (value: TableSort[]) => props.onSort?.(value),
      'onClick:row': props.onRowClick
        ? (_event: Event, { item }: { item: TableRow }) =>
            props.onRowClick?.(item)
        : undefined,
    }),
  );
DataTableView.props = [
  'columns',
  'rows',
  'caption',
  'density',
  'search',
  'sortBy',
  'itemsPerPage',
  'loading',
  'emptyText',
  'onSort',
  'onRowClick',
];

export const mountTable = (
  container: Element,
  props: TableProps,
): Mounted<TableProps> => mountComponent(container, TableView, props);

export const mountDataTable = (
  container: Element,
  props: DataTableProps,
): Mounted<DataTableProps> => mountComponent(container, DataTableView, props);
