CREATE TABLE dept(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL
);
CREATE TABLE emp(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dept_id INTEGER REFERENCES dept(id),
  title TEXT NOT NULL,
  salary INTEGER,
  bonus INTEGER,
  mgr_id INTEGER REFERENCES emp(id),
  hired TEXT NOT NULL,
  email TEXT
);
INSERT INTO dept VALUES
 (1, 'Eng', 'Berlin'),
 (2, 'Ops', 'Lisbon'),
 (3, 'Sales', 'Madrid'),
 (4, 'Legal', 'Paris');
INSERT INTO emp VALUES
 (1, 'Ann', 1, 'CTO', 9000, 500, NULL, '2015-03-01', 'ann@corp.example'),
 (2, 'Bob', 1, 'Lead', 7000, 300, 1, '2016-07-15', 'bob@corp.example'),
 (3, 'Cid', 1, 'Dev', 6000, NULL, 2, '2018-01-10', 'cid@corp.example'),
 (4, 'Dee', 1, 'Dev', 6000, 200, 2, '2019-09-01', 'dee@corp.example'),
 (5, 'Eve', 1, 'Dev', 5000, NULL, 2, '2021-05-20', 'eve@corp.example'),
 (6, 'Fay', 2, 'Manager', 6500, 400, 1, '2017-02-28', 'fay@corp.example'),
 (7, 'Gus', 2, 'Analyst', 4500, NULL, 6, '2020-11-11', 'gus@corp.example'),
 (8, 'Hal', 2, 'Analyst', NULL, NULL, 6, '2022-04-04', 'hal@corp.example'),
 (9, 'Ivy', 3, 'Manager', 7500, 1200, 1, '2016-12-01', 'ivy@corp.example'),
 (10, 'Jon', 3, 'Rep', 4000, 800, 9, '2019-03-15', 'jon@corp.example'),
 (11, 'Kim', 3, 'Rep', 4000, 600, 9, '2021-08-30', 'kim@corp.example'),
 (12, 'Lee', 3, 'Rep', 4000, NULL, 9, '2023-01-09', 'lee@corp.example'),
 (13, 'Max', NULL, 'Advisor', 5500, NULL, 1, '2020-06-01', NULL),
 (14, 'Nia', 2, 'Analyst', 4500, 100, 7, '2023-10-02', 'nia@corp.example');
CREATE VIEW dept_payroll AS
  SELECT d.name AS dept, count(e.id) AS headcount, sum(e.salary) AS payroll
  FROM dept d
  LEFT JOIN emp e ON e.dept_id = d.id
  GROUP BY d.id;
