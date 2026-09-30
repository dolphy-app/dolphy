SELECT a.name AS employee, b.name AS colleague
FROM emp a
JOIN emp b ON b.dept_id = a.dept_id AND a.id < b.id;
