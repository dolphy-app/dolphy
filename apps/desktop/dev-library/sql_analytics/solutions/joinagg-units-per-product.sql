SELECT p.title, coalesce(sum(oi.qty), 0) AS units
FROM product p
LEFT JOIN order_item oi ON oi.product_id = p.id
GROUP BY p.id;
