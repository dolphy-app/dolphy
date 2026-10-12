SELECT c.name AS customer, p.title AS product, oi.qty
FROM customer c
JOIN orders o ON o.customer_id = c.id
JOIN order_item oi ON oi.order_id = o.id
JOIN product p ON p.id = oi.product_id
WHERE c.name = 'Acme' AND o.status = 'paid';
