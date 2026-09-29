/**
 * Корпус из 30 проверок (спайк sql-runner, `checks.ts`): фикстура `emp.sql`
 * (NULL в ключе и в зарплате, ничьи по зарплате, самосвязь). Ожидаемые CSV
 * написаны вручную на бумаге, а не получены прогоном эталонного SQL.
 */
import { readFileSync } from 'node:fs';
import type { CheckRequest, CompareOptions } from '../../src/types.ts';

export const EMP_FIXTURE = readFileSync(
  new URL('../fixtures/emp.sql', import.meta.url),
  'utf8',
);

export interface CheckDef {
  id: string;
  lesson:
    'select' | 'where' | 'aggregate' | 'join' | 'subquery' | 'window' | 'misc';
  /** Эталонное решение; ожидаемый CSV посчитан вручную. */
  solution: string;
  expected: string;
  compare?: CompareOptions;
  /** Неверные ответы: обязаны дать `failed/mismatch`. */
  wrong?: string[];
  /** Другие верные формулировки: обязаны пройти. */
  alt?: string[];
}

export const CHECKS: readonly CheckDef[] = [
  {
    id: 'where-gt-null-excluded',
    lesson: 'where',
    solution: 'SELECT name FROM emp WHERE salary > 70',
    expected: 'name\nAnn\nBob\nCid',
    wrong: ['SELECT name FROM emp WHERE salary > 70 OR salary IS NULL'],
    alt: ['SELECT name FROM emp WHERE NOT salary <= 70 ORDER BY name DESC'],
  },
  {
    id: 'where-is-null',
    lesson: 'where',
    solution: 'SELECT name FROM emp WHERE salary IS NULL',
    expected: 'name\nEve',
    wrong: ['SELECT name FROM emp WHERE salary = NULL'],
  },
  {
    id: 'where-ne-null-trap',
    lesson: 'where',
    solution: 'SELECT name FROM emp WHERE dept_id <> 1',
    expected: 'name\nDee\nEve',
    wrong: ['SELECT name FROM emp WHERE dept_id IS NOT 1'],
  },
  {
    id: 'join-inner-alias',
    lesson: 'join',
    solution:
      'SELECT e.name, d.name AS dept FROM emp e JOIN dept d ON d.id = e.dept_id',
    expected: 'name,dept\nAnn,Eng\nBob,Eng\nCid,Eng\nDee,Ops\nEve,Ops',
    wrong: [
      'SELECT e.name, d.name AS department FROM emp e JOIN dept d ON d.id = e.dept_id',
    ],
  },
  {
    id: 'join-left-unmatched',
    lesson: 'join',
    solution:
      'SELECT d.name AS dept, e.name AS emp FROM dept d LEFT JOIN emp e ON e.dept_id = d.id',
    expected: 'dept,emp\nEng,Ann\nEng,Bob\nEng,Cid\nOps,Dee\nOps,Eve\nSales,',
    wrong: [
      'SELECT d.name AS dept, e.name AS emp FROM dept d JOIN emp e ON e.dept_id = d.id',
    ],
  },
  {
    id: 'join-self-manager',
    lesson: 'join',
    solution:
      'SELECT e.name AS emp, m.name AS boss FROM emp e JOIN emp m ON m.id = e.mgr_id',
    expected: 'emp,boss\nBob,Ann\nCid,Ann\nDee,Ann\nEve,Dee\nFay,Dee',
  },
  {
    id: 'agg-group-null-key',
    lesson: 'aggregate',
    solution:
      'SELECT dept_id, count(*) AS n, sum(salary) AS total, avg(salary) AS mean FROM emp GROUP BY dept_id',
    expected:
      'dept_id,n,total,mean\n1,3,260,86.66666666666667\n2,2,60,60.0\n,1,50,50.0',
    wrong: [
      'SELECT dept_id, count(*) AS n, sum(salary) AS total, avg(salary) AS mean FROM emp WHERE dept_id IS NOT NULL GROUP BY dept_id',
    ],
  },
  {
    id: 'agg-count-variants',
    lesson: 'aggregate',
    solution:
      'SELECT count(*) AS a, count(salary) AS b, count(DISTINCT dept_id) AS c FROM emp',
    expected: 'a,b,c\n6,5,2',
    wrong: [
      'SELECT count(*) AS a, count(*) AS b, count(dept_id) AS c FROM emp',
    ],
  },
  {
    id: 'agg-having',
    lesson: 'aggregate',
    solution: 'SELECT dept_id FROM emp GROUP BY dept_id HAVING count(*) >= 2',
    expected: 'dept_id\n1\n2',
    wrong: ['SELECT DISTINCT dept_id FROM emp'],
  },
  {
    id: 'window-rank-ties',
    lesson: 'window',
    solution:
      'SELECT name, rank() OVER (ORDER BY salary DESC) AS r, dense_rank() OVER (ORDER BY salary DESC) AS d FROM emp WHERE salary IS NOT NULL',
    expected: 'name,r,d\nAnn,1,1\nBob,2,2\nCid,2,2\nDee,4,3\nFay,5,4',
    wrong: [
      'SELECT name, row_number() OVER (ORDER BY salary DESC) AS r, dense_rank() OVER (ORDER BY salary DESC) AS d FROM emp WHERE salary IS NOT NULL',
    ],
  },
  {
    id: 'window-default-frame-peers',
    lesson: 'window',
    solution:
      'SELECT name, sum(salary) OVER (ORDER BY salary) AS run FROM emp WHERE salary IS NOT NULL',
    expected: 'name,run\nFay,50\nDee,110\nBob,270\nCid,270\nAnn,370',
    wrong: [
      'SELECT name, sum(salary) OVER (ORDER BY salary, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS run FROM emp WHERE salary IS NOT NULL',
    ],
  },
  {
    id: 'window-partition-rownum-null-last-desc',
    lesson: 'window',
    solution:
      'SELECT name, row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC, name) AS rn FROM emp WHERE dept_id IS NOT NULL',
    expected: 'name,rn\nAnn,1\nBob,2\nCid,3\nDee,1\nEve,2',
  },
  {
    id: 'window-lag-null-arith',
    lesson: 'window',
    solution:
      'SELECT name, salary - lag(salary) OVER (ORDER BY id) AS diff FROM emp',
    expected: 'name,diff\nAnn,\nBob,-20\nCid,0\nDee,-20\nEve,\nFay,',
  },
  {
    id: 'subq-scalar-avg-ignores-null',
    lesson: 'subquery',
    solution:
      'SELECT name FROM emp WHERE salary > (SELECT avg(salary) FROM emp)',
    expected: 'name\nAnn\nBob\nCid',
  },
  {
    id: 'subq-correlated-max',
    lesson: 'subquery',
    solution:
      'SELECT name FROM emp e WHERE salary = (SELECT max(salary) FROM emp WHERE dept_id = e.dept_id)',
    expected: 'name\nAnn\nDee',
  },
  {
    id: 'subq-not-in-null-trap',
    lesson: 'subquery',
    solution: 'SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM emp)',
    expected: 'name',
    wrong: [
      'SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM emp WHERE dept_id IS NOT NULL)',
    ],
  },
  {
    id: 'subq-not-exists',
    lesson: 'subquery',
    solution:
      'SELECT name FROM dept d WHERE NOT EXISTS (SELECT 1 FROM emp e WHERE e.dept_id = d.id)',
    expected: 'name\nSales',
    alt: [
      'SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM emp WHERE dept_id IS NOT NULL)',
    ],
  },
  {
    id: 'select-order-desc-nulls',
    lesson: 'select',
    solution: 'SELECT name FROM emp ORDER BY salary DESC, name',
    expected: 'name\nAnn\nBob\nCid\nDee\nFay\nEve',
    compare: { orderSensitive: true },
    wrong: [
      'SELECT name FROM emp ORDER BY salary DESC NULLS FIRST, name',
      'SELECT name FROM emp ORDER BY name',
    ],
  },
  {
    id: 'select-order-insensitive-default',
    lesson: 'select',
    solution: 'SELECT name FROM emp ORDER BY name DESC',
    expected: 'name\nAnn\nBob\nCid\nDee\nEve\nFay',
    alt: ['SELECT name FROM emp'],
  },
  {
    id: 'select-duplicates-kept',
    lesson: 'select',
    solution: 'SELECT dept_id FROM emp WHERE dept_id IS NOT NULL',
    expected: 'dept_id\n1\n1\n1\n2\n2',
    wrong: ['SELECT DISTINCT dept_id FROM emp WHERE dept_id IS NOT NULL'],
  },
  {
    id: 'select-column-alias-case',
    lesson: 'select',
    solution: 'SELECT sum(salary) AS total FROM emp',
    expected: 'total\n370',
    alt: ['SELECT sum(salary) AS TOTAL FROM emp'],
    wrong: [
      'SELECT sum(salary) AS total_salary FROM emp',
      'SELECT sum(salary) FROM emp',
    ],
  },
  {
    id: 'select-column-order-any',
    lesson: 'select',
    solution: 'SELECT id, name FROM dept WHERE id = 1',
    expected: 'id,name\n1,Eng',
    compare: { columnOrder: 'any' },
    alt: ['SELECT name, id FROM dept WHERE id = 1'],
  },
  {
    id: 'select-ignore-names',
    lesson: 'select',
    solution: 'SELECT count(*) FROM emp',
    expected: 'n\n6',
    compare: { ignoreColumnNames: true },
  },
  {
    id: 'select-float-tolerance',
    lesson: 'misc',
    solution: 'SELECT 0.1 + 0.2 AS x',
    expected: 'x\n0.3',
    wrong: [],
  },
  {
    id: 'select-int-vs-real',
    lesson: 'misc',
    solution: 'SELECT 1.0 AS x',
    expected: 'x\n1',
    alt: ['SELECT 1 AS x'],
  },
  {
    id: 'select-integer-division',
    lesson: 'misc',
    solution: 'SELECT 3 / 2.0 AS x',
    expected: 'x\n1.5',
    wrong: ['SELECT 3 / 2 AS x'],
  },
  {
    id: 'select-text-vs-int',
    lesson: 'misc',
    solution: "SELECT '1' AS x",
    expected: 'x\n"1"',
    wrong: ['SELECT 1 AS x'],
  },
  {
    id: 'cte-plain',
    lesson: 'misc',
    solution:
      'WITH t AS (SELECT dept_id, max(salary) AS m FROM emp GROUP BY dept_id) SELECT count(*) AS n FROM t',
    expected: 'n\n3',
  },
  {
    id: 'cte-recursive-finite',
    lesson: 'misc',
    solution:
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5) SELECT sum(x) AS s FROM c',
    expected: 's\n15',
  },
  {
    id: 'blob-hex',
    lesson: 'misc',
    solution: "SELECT hex(x'0aFF') AS h",
    expected: 'h\n0AFF',
  },
];

export const toRequest = (
  check: CheckDef,
  learnerSql: string,
): CheckRequest => ({
  fixtureSql: EMP_FIXTURE,
  learnerSql,
  expected: { csv: check.expected },
  ...(check.compare === undefined ? {} : { compare: check.compare }),
});
