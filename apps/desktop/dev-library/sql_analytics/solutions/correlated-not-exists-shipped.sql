SELECT p.title FROM product p
WHERE NOT EXISTS (
  SELECT 1
  FROM order_item oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = p.id AND o.status = 'shipped'
);
