SELECT name, salary + coalesce(bonus, 0) AS total FROM emp;
