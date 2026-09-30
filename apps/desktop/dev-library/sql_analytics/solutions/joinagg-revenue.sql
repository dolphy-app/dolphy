SELECT c.name, sum(oi.qty * p.price) AS revenue
FROM customer c
JOIN orders o ON o.customer_id = c.id
JOIN order_item oi ON oi.order_id = o.id
JOIN product p ON p.id = oi.product_id
WHERE o.status <> 'cancelled'
GROUP BY c.id;
