---
"@valbuild/ui": patch
---

Fix the date field storing the day before the one that was picked, for editors in timezones ahead of UTC.

The calendar hands back a `Date` at local midnight, and the field stored `date.toISOString().slice(0, 10)` - the UTC day of that instant. East of UTC those are different days: local midnight on the 20th is 22:00 on the 19th in UTC, so an editor in CEST who picked the 21st got the 20th stored, and the field visibly snapped back to the wrong day. West of UTC the two agreed, which is why this survived.

Reading a stored day had the mirror image of the same bug: `new Date("1981-12-30")` is UTC midnight, so the field and the list preview rendered the day before in any timezone behind UTC, and the preview also showed a meaningless time of day.

Days are now converted through the local calendar fields in both directions, via `parseLocalDay` / `formatLocalDay`. The same helper replaces the inline day formatting in the datetime field, which already did this correctly. Bounds (`from` / `to`) are parsed as local days too, so the calendar no longer offers a day that the schema then rejects.

Two related improvements fall out of parsing the value properly: a stored value that is not a date no longer throws while formatting (`s.date()` validates its bounds but not its shape, so such values do exist) - the field renders empty and the preview shows the raw string - and a value like `2026-02-31`, which `Date` would silently roll over to the 3rd of March, is now rejected instead.
