SELECT c.name
FROM customer c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
WHERE o.id IS NULL;
