# CASE и условные агрегаты

`CASE` — выражение-«если-то»: возвращает значение первой ветки `WHEN`, условие которой истинно.

```sql
CASE
  WHEN salary IS NULL THEN 'n/a'
  WHEN salary >= 7000 THEN 'high'
  ELSE 'low'
END
```

- Ветки проверяются **сверху вниз**, порядок важен. Неизвестное условие (`NULL`) ветку не выбирает и проваливается дальше — часто прямо в `ELSE`. `NULL` проверяйте первой веткой.
- Без `ELSE` результат `NULL`.
- Простая форма: `CASE title WHEN 'CTO' THEN 1 ELSE 2 END`.
- `CASE` уместен и в `ORDER BY` (свой порядок значений), и внутри агрегата: `sum(CASE WHEN cond THEN 1 ELSE 0 END)` — условный счётчик.
- `count(CASE WHEN cond THEN 1 ELSE 0 END)` — типичная ошибка: `0` — тоже не `NULL`, и `count` посчитает все строки. Для `count` ветка «нет» должна давать `NULL` (без `ELSE`).
