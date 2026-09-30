SELECT name, salary * 12 AS yearly
FROM emp
WHERE salary IS NOT NULL
ORDER BY yearly DESC, name
LIMIT 3;
