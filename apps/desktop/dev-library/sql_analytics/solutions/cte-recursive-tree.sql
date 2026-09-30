WITH RECURSIVE tree(id, name, depth) AS (
  SELECT id, name, 0 FROM emp WHERE id = 1
  UNION ALL
  SELECT e.id, e.name, tree.depth + 1
  FROM emp e
  JOIN tree ON e.mgr_id = tree.id
)
SELECT name, depth FROM tree;
