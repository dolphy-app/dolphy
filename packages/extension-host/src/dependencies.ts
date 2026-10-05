import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import type { ExtensionDependency } from '@dolphy-app/extension-api';
import { satisfiesRange } from '@dolphy-app/extension-catalog';

/** То, что нужно разбору зависимостей от расширения. */
export interface DependencyNode {
  id: string;
  version: string;
  dependencies: readonly ExtensionDependency[];
}

/** Расширения на циклах: id → члены цикла в порядке входа. */
export type DependencyCycles = ReadonlyMap<string, readonly string[]>;

/**
 * Расширения, лежащие на циклах зависимостей (сильно связная компонента;
 * зависимость от самого себя — цикл из одного). Отсутствующие зависимости
 * рёбер не дают.
 */
export const dependencyCycles = (
  nodes: readonly DependencyNode[],
): DependencyCycles => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = new Map(nodes.map((node, position) => [node.id, position]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();
  let counter = 0;
  const visit = (node: DependencyNode): void => {
    let lowest = counter;
    index.set(node.id, counter);
    counter += 1;
    stack.push(node.id);
    onStack.add(node.id);
    for (const { id } of node.dependencies) {
      const next = byId.get(id);
      if (next === undefined) continue;
      if (!index.has(id)) {
        visit(next);
        lowest = Math.min(lowest, low.get(id) ?? lowest);
      } else if (onStack.has(id)) {
        lowest = Math.min(lowest, index.get(id) ?? lowest);
      }
    }
    low.set(node.id, lowest);
    if (lowest !== index.get(node.id)) return;
    const members: string[] = [];
    for (;;) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      members.push(member);
      if (member === node.id) break;
    }
    const selfLoop = node.dependencies.some(({ id }) => id === node.id);
    if (members.length === 1 && !selfLoop) return;
    members.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const member of members) cycles.set(member, members);
  };
  for (const node of nodes) if (!index.has(node.id)) visit(node);
  return cycles;
};

/**
 * Порядок «зависимость раньше зависимого»; между независимыми расширениями
 * сохраняется прежний порядок. Зависимости, которых нет в наборе, не
 * учитываются; цикл рвётся на первом ребре назад: его члены всё равно не
 * загружаются.
 */
export const orderByDependencies = <T extends DependencyNode>(
  nodes: readonly T[],
): T[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered: T[] = [];
  const visited = new Set<string>();
  const visit = (node: T): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const { id } of node.dependencies) {
      const dependency = byId.get(id);
      if (dependency !== undefined) visit(dependency);
    }
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
};

export interface DependencyEnvironment<T extends DependencyNode> {
  nodes: readonly T[];
  /** Расширение само не выключено (пользователем, безопасным режимом, отзывом); его зависимости не в счёт. */
  isOn(node: T): boolean;
  /** `dependencyCycles(nodes)`; вызывающий кэширует по набору. */
  cycles: DependencyCycles;
}

const reference = (dependency: ExtensionDependency) => ({
  id: dependency.id,
  ...(dependency.range === null ? {} : { range: dependency.range }),
});

/**
 * Невыполненные зависимости расширения: пусто — загружается. Зависимость
 * подходит, если она есть, включена, сама загружена (её зависимости
 * выполнены) и версия попадает в диапазон. Член цикла получает только
 * `dependency-cycle`.
 */
export const dependencyIssues = <T extends DependencyNode>(
  node: T,
  environment: DependencyEnvironment<T>,
): ExtensionDiagnosticDto[] => {
  const byId = new Map(environment.nodes.map((item) => [item.id, item]));
  const memo = new Map<string, ExtensionDiagnosticDto[]>();
  const issuesOf = (current: T): ExtensionDiagnosticDto[] => {
    const known = memo.get(current.id);
    if (known !== undefined) return known;
    const cycle = environment.cycles.get(current.id);
    const issues: ExtensionDiagnosticDto[] =
      cycle === undefined
        ? current.dependencies.flatMap(
            (dependency): ExtensionDiagnosticDto[] => {
              const found = byId.get(dependency.id);
              if (found === undefined) {
                return [
                  { code: 'dependency-missing', data: reference(dependency) },
                ];
              }
              if (!environment.isOn(found)) {
                return [
                  { code: 'dependency-disabled', data: reference(dependency) },
                ];
              }
              if (
                dependency.range !== null &&
                !satisfiesRange(found.version, dependency.range)
              ) {
                return [
                  {
                    code: 'dependency-version',
                    data: { ...reference(dependency), found: found.version },
                  },
                ];
              }
              return issuesOf(found).length > 0
                ? [{ code: 'dependency-unmet', data: reference(dependency) }]
                : [];
            },
          )
        : [{ code: 'dependency-cycle', data: { cycle: [...cycle] } }];
    memo.set(current.id, issues);
    return issues;
  };
  return issuesOf(node);
};
