# Строки и даты

**Строки.** `length(s)`, `upper(s)`, `lower(s)`, `trim(s)`, `replace(s, from, to)`, `instr(s, part)` (позиция с 1, 0 — не найдено), `substr(s, start, len)` (с 1). Любая из них от `NULL` даёт `NULL`.

**Даты** в SQLite — обычный текст в формате ISO `YYYY-MM-DD`; такие строки правильно сортируются и сравниваются.

- `strftime('%Y', d)` — год (но **текстом**: `'2019'`), `%m` — месяц, `%d` — день. В число: `CAST(... AS INTEGER)`.
- `date(d, '+1 year')`, `date(d, '-3 months')`, `date(d, 'start of month')` — сдвиги.
- `julianday(a) - julianday(b)` — разница в днях (дробная). Вычитание самих строк-дат даёт бессмыслицу: SQLite возьмёт числовой префикс.
