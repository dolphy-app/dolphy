SELECT title, count(*) AS n FROM emp GROUP BY title HAVING count(*) >= 2;
