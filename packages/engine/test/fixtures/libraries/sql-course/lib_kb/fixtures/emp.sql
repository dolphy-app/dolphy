CREATE TABLE dept(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE emp(id INTEGER PRIMARY KEY, name TEXT NOT NULL, dept_id INTEGER, salary INTEGER, mgr_id INTEGER);
INSERT INTO dept VALUES (1,'Eng'),(2,'Ops'),(3,'Sales');
INSERT INTO emp VALUES
 (1,'Ann',1,100,NULL),
 (2,'Bob',1,80,1),
 (3,'Cid',1,80,1),
 (4,'Dee',2,60,1),
 (5,'Eve',2,NULL,4),
 (6,'Fay',NULL,50,4);
