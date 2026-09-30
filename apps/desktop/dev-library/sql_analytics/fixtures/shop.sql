CREATE TABLE customer(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  joined TEXT NOT NULL
);
CREATE TABLE product(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL
);
CREATE TABLE orders(
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customer(id),
  ordered_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE order_item(
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  qty INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO customer VALUES
 (1, 'Acme', 'DE', '2023-01-15'),
 (2, 'Bolt', 'DE', '2023-03-02'),
 (3, 'Cora', 'FR', '2023-06-20'),
 (4, 'Dune', 'FR', '2023-11-05'),
 (5, 'Echo', 'ES', '2024-01-10'),
 (6, 'Fjord', 'ES', '2024-02-14'),
 (7, 'Gale', 'PT', '2024-03-01');
INSERT INTO product VALUES
 (1, 'Laptop', 'hardware', 1200),
 (2, 'Mouse', 'hardware', 25),
 (3, 'Monitor', 'hardware', 300),
 (4, 'Desk', 'furniture', 450),
 (5, 'Chair', 'furniture', 200),
 (6, 'Ebook', 'digital', 15),
 (7, 'Course', 'digital', 99),
 (8, 'Lamp', 'furniture', 40);
INSERT INTO orders VALUES
 (1, 1, '2024-01-05', 'paid'),
 (2, 1, '2024-02-11', 'paid'),
 (3, 2, '2024-01-20', 'shipped'),
 (4, 3, '2024-02-03', 'paid'),
 (5, 3, '2024-02-28', 'cancelled'),
 (6, 3, '2024-03-15', 'paid'),
 (7, 4, '2024-03-02', 'paid'),
 (8, 1, '2024-03-22', 'shipped'),
 (9, 5, '2024-03-25', 'paid'),
 (10, 2, '2024-04-09', 'paid'),
 (11, 7, '2024-04-12', 'cancelled'),
 (12, 1, '2024-04-30', 'paid'),
 (13, 4, '2024-05-06', 'paid'),
 (14, 3, '2024-05-19', 'paid'),
 (15, NULL, '2024-05-20', 'paid');
INSERT INTO order_item VALUES
 (1, 1, 1), (1, 2, 2),
 (2, 4, 1), (2, 5, 2),
 (3, 3, 2),
 (4, 6, 1), (4, 7, 1),
 (5, 1, 1),
 (6, 2, 3), (6, 6, 2),
 (7, 1, 1), (7, 3, 1),
 (8, 5, 1),
 (9, 7, 2),
 (10, 2, 1), (10, 4, 1),
 (11, 3, 1),
 (12, 7, 1), (12, 6, 3),
 (13, 1, 1),
 (14, 5, 2), (14, 2, 1),
 (15, 6, 1);
