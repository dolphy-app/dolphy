SELECT e.name, d.city FROM emp e JOIN dept d ON d.id = e.dept_id WHERE d.city IN ('Berlin', 'Madrid');
