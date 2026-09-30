SELECT d.name AS dept, count(e.id) AS n
FROM dept d
LEFT JOIN emp e ON e.dept_id = d.id
GROUP BY d.id;
