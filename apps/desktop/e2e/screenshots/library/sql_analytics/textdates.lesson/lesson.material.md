# Text and dates

**Strings.** `length(s)`, `upper(s)`, `lower(s)`, `trim(s)`, `replace(s, from, to)`, `instr(s, part)` (1-based position, 0 if not found), `substr(s, start, len)` (1-based). Each of them returns `NULL` for a `NULL` input.

**Dates** in SQLite are plain text in ISO `YYYY-MM-DD` format; such strings sort and compare correctly.

- `strftime('%Y', d)` gives the year (but **as text**: `'2019'`), `%m` the month, `%d` the day. Convert to a number with `CAST(... AS INTEGER)`.
- `date(d, '+1 year')`, `date(d, '-3 months')`, `date(d, 'start of month')` shift dates.
- `julianday(a) - julianday(b)` is the difference in days (fractional). Subtracting the date strings themselves gives nonsense: SQLite just takes the numeric prefix.
