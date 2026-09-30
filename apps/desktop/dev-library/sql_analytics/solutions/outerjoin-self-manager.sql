SELECT e.name, m.name AS mgr FROM emp e LEFT JOIN emp m ON m.id = e.mgr_id;
