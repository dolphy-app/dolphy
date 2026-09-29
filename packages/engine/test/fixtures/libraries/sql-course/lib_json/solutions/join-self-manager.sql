SELECT e.name AS emp, m.name AS boss FROM emp e JOIN emp m ON m.id = e.mgr_id;
