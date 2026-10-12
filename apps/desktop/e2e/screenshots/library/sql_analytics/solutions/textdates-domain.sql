SELECT name, substr(email, instr(email, '@') + 1) AS domain FROM emp;
