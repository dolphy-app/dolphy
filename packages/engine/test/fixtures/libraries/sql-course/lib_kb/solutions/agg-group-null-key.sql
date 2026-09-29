SELECT dept_id, count(*) AS n, sum(salary) AS total, avg(salary) AS mean FROM emp GROUP BY dept_id;
