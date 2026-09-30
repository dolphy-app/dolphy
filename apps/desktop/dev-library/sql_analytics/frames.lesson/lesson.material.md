# Кадры окна, LAG и LEAD

**Кадр** (frame) — подмножество строк окна, по которому считается функция: `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW`.

- Если в `OVER` есть `ORDER BY`, а кадр не указан, действует `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`: в кадр входят **все строки с таким же значением ключа** (peers). Поэтому нарастающий итог по ключу с повторами у «ничьих» одинаков. Чтобы суммировать строго построчно, добавьте уникальный ключ в `ORDER BY` или задайте `ROWS`.
- Скользящее среднее за два месяца: `avg(x) OVER (ORDER BY m ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)`.
- `last_value(x)` с кадром по умолчанию возвращает значение текущей строки; чтобы получить последнее значение окна, укажите `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- `lag(x, n, default)` — значение `n` строк назад, `lead` — вперёд; если такой строки нет, результат `default` (по умолчанию `NULL`). Кадр на них не влияет.
- Для помесячных рядов сначала агрегируйте в CTE: `strftime('%Y-%m', ordered_at)`.
