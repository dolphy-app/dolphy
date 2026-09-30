SELECT DISTINCT c.name
FROM customer c
JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';
