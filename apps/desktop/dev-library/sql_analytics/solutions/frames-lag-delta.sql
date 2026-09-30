WITH monthly AS (
  SELECT strftime('%Y-%m', o.ordered_at) AS month, sum(oi.qty * p.price) AS revenue
  FROM orders o
  JOIN order_item oi ON oi.order_id = o.id
  JOIN product p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY month
)
SELECT month, revenue, revenue - lag(revenue) OVER (ORDER BY month) AS delta
FROM monthly;
