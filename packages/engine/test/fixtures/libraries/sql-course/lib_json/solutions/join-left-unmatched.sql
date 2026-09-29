SELECT d.name AS dept, e.name AS emp FROM dept d LEFT JOIN emp e ON e.dept_id = d.id;
