# NULL и трёхзначная логика

`NULL` — «значение неизвестно». Сравнение с ним даёт не истину и не ложь, а **UNKNOWN**; `WHERE` пропускает только истину.

- `x = NULL` и `x <> NULL` всегда UNKNOWN. Проверять нужно `x IS NULL` и `x IS NOT NULL`.
- `NULL OR TRUE` = TRUE, `NULL AND FALSE` = FALSE, `NOT NULL` = NULL.
- `x NOT IN (1, 2)` при `x = NULL` — UNKNOWN: строка с неизвестным значением **не** попадает в результат.
- `COALESCE(a, b, ...)` возвращает первое не-`NULL` значение; `NULLIF(a, b)` даёт `NULL`, если `a = b`.
- `IS NOT` в SQLite сравнивает как `<>`, но считает `NULL` обычным значением: `salary IS NOT 6000` истинно и для `NULL`.
