CREATE TABLE account(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at TEXT NOT NULL,
  note TEXT,
  seats INTEGER NOT NULL DEFAULT 1
);
INSERT INTO account(email, created_at) VALUES
 ('a@corp.example', '2024-01-10'),
 ('b@corp.example', '2024-02-03');
INSERT INTO account(email, plan, created_at, seats) VALUES
 ('c@corp.example', 'pro', '2024-03-21', 5);
