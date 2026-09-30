SELECT status AS label, count(*) AS n FROM orders GROUP BY status
UNION ALL
SELECT 'ALL', count(*) FROM orders;
