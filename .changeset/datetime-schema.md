---
"@valbuild/core": minor
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
"@valbuild/react": patch
---

Add `s.dateTime()` schema type for ISO 8601 datetime values, with a calendar + time + timezone editor in the UI. Stored values are always ISO UTC strings. Also fix `s.date()` so its empty/default value is clamped to the configured `.from()`/`.to()` bounds (previously it always returned today, which could be outside the allowed range).
