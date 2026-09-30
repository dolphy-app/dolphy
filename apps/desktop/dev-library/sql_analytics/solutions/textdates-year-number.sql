SELECT name, CAST(strftime('%Y', hired) AS INTEGER) AS year FROM emp;
