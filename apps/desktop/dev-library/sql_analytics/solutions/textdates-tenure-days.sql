SELECT name, CAST(julianday('2024-01-01') - julianday(hired) AS INTEGER) AS days FROM emp;
