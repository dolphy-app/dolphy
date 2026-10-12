WITH rev AS (
  SELECT c.country, c.name, sum(oi.qty * p.price) AS revenue
  FROM customer c
  JOIN orders o ON o.customer_id = c.id
  JOIN order_item oi ON oi.order_id = o.id
  JOIN product p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY c.id
),
best AS (
  SELECT country, max(revenue) AS top FROM rev GROUP BY country
)
SELECT rev.country, rev.name
FROM rev
JOIN best ON best.country = rev.country AND best.top = rev.revenue;
