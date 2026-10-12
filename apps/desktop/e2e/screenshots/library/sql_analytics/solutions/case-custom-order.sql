SELECT name, title
FROM emp
ORDER BY
  CASE title
    WHEN 'CTO' THEN 1
    WHEN 'Lead' THEN 2
    WHEN 'Manager' THEN 3
    WHEN 'Advisor' THEN 4
    ELSE 5
  END,
  name;
