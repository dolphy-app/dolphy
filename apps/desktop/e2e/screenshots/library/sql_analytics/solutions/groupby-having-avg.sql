SELECT dept_id, round(avg(salary)) AS avg_salary
FROM emp
GROUP BY dept_id
HAVING avg(salary) > 5000;
