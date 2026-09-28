---
"@valbuild/core": patch
"@valbuild/ui": patch
---

`s.date()` now reports a value that is not a real `YYYY-MM-DD` day as a validation error. It used to check only `from` / `to`, and compared those as plain strings, so a typo like `"19f81-12-30"` passed a `.from("1900-01-01").to("2024-01-01")` range without a word. Impossible days such as `"2023-02-29"` are rejected too, and a `from` / `to` bound that is not a valid date is reported as a schema error.
