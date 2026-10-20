---
"@valbuild/core": minor
---

`s.router` takes a key schema and route parameter schemas together: `s.router(router, key, params, item)`. The key schema describes the whole URL, and is what the Studio's "New page" form shows, while each parameter's schema checks its part of it. Until now a route module had to choose between the two.

```ts
s.router(
  tanstackRouter,
  s.string().describe("The URL of this news story"),
  { locale: urlLocale, slug: s.string().regexp(/^[a-z0-9-]+$/) },
  item,
);
```
