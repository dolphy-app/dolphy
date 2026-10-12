WITH order_total AS (
  SELECT o.id, sum(oi.qty * p.price) AS total
  FROM orders o
  JOIN order_item oi ON oi.order_id = o.id
  JOIN product p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id
)
SELECT id, total FROM order_total WHERE total > (SELECT avg(total) FROM order_total);
