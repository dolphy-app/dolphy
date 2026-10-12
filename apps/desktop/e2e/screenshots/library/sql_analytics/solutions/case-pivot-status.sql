SELECT
  sum(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid,
  sum(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped,
  sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM orders;
