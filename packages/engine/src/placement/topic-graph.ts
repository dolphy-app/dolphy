import {
  buildIndexedGraph,
  topoOrder,
  transitiveReduction,
} from '../domain/graph-algorithms.ts';

/**
 * Граф тем диагностики: пререквизиты после транзитивной редукции (CSR вверх и
 * вниз), топологический порядок и уровни. Диагностика всегда работает на
 * редукции: расстояния и цепочки зависят от неё (report-diagnostic.md §8.3).
 */
export interface TopicGraph {
  readonly size: number;
  readonly ids: readonly string[];
  /** Прямые пререквизиты темы `u`: `upTargets[upOffsets[u] .. upOffsets[u + 1])`, по возрастанию. */
  readonly upOffsets: Int32Array;
  readonly upTargets: Int32Array;
  /** Прямые зависимые темы `u`, по возрастанию. */
  readonly downOffsets: Int32Array;
  readonly downTargets: Int32Array;
  /** Топологический порядок, пререквизиты раньше зависимых. */
  readonly order: Int32Array;
  /** Длина самого длинного пути от корня (корни — 0). */
  readonly level: Int32Array;
  readonly maxLevel: number;
  readonly rawEdges: number;
  readonly keptEdges: number;
}

const toCsr = (lists: readonly (readonly number[])[]) => {
  const offsets = new Int32Array(lists.length + 1);
  let total = 0;
  for (let i = 0; i < lists.length; i++) {
    total += (lists[i] as readonly number[]).length;
    offsets[i + 1] = total;
  }
  const targets = new Int32Array(total);
  let cursor = 0;
  for (const list of lists)
    for (const target of list) targets[cursor++] = target;
  return { offsets, targets };
};

/**
 * Строит граф тем. `prerequisitesOf(id)` — прямые пререквизиты; ссылки вне
 * `ids` и повторы отбрасываются молча (повтор редукция всё равно снимает), цикл
 * или самопетля — `Error`.
 */
export const buildTopicGraph = (
  ids: readonly string[],
  prerequisitesOf: (id: string) => Iterable<string> | undefined,
): TopicGraph => {
  const indexed = buildIndexedGraph(ids, prerequisitesOf);
  const order = topoOrder(indexed);
  if (order === null) throw new Error('prerequisite graph has a cycle');
  const reduction = transitiveReduction(indexed, order);
  const { size, offsets, targets } = indexed;

  const up: number[][] = Array.from({ length: size }, () => []);
  const down: number[][] = Array.from({ length: size }, () => []);
  for (let unit = 0; unit < size; unit++) {
    const kept: number[] = [];
    for (
      let e = offsets[unit] as number;
      e < (offsets[unit + 1] as number);
      e++
    ) {
      if (reduction.keep[e] === 1) kept.push(targets[e] as number);
    }
    kept.sort((a, b) => a - b);
    up[unit] = kept;
  }
  for (let unit = 0; unit < size; unit++) {
    for (const prerequisite of up[unit] as number[]) {
      (down[prerequisite] as number[]).push(unit);
    }
  }

  const level = new Int32Array(size);
  let maxLevel = 0;
  for (let k = 0; k < size; k++) {
    const unit = order[k] as number;
    let value = 0;
    for (const prerequisite of up[unit] as number[]) {
      value = Math.max(value, (level[prerequisite] as number) + 1);
    }
    level[unit] = value;
    if (value > maxLevel) maxLevel = value;
  }

  const upCsr = toCsr(up);
  const downCsr = toCsr(down);
  return {
    size,
    ids,
    upOffsets: upCsr.offsets,
    upTargets: upCsr.targets,
    downOffsets: downCsr.offsets,
    downTargets: downCsr.targets,
    order,
    level,
    maxLevel,
    rawEdges: indexed.edgeCount,
    keptEdges: reduction.kept,
  };
};
