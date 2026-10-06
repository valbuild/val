---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/tanstack": minor
"@valbuild/next": minor
---

Routers can give each route parameter a schema, and a URL can say which language a page is in.

- **`s.router(router, params, item)`** takes a schema per route parameter, by the name the route file gives it (`$slug`, `[slug]`, `{-$locale}`). Each key's parameters are validated against them, and a name the route does not have is a schema error.

  ```ts
  s.router(tanstackRouter, { locale: urlLocale, slug: s.string() }, item);
  ```

- **`s.enum(...).locales({ ... })`** says which of the project's languages each value means, so `/nb/…` can mean `nb-NO`. The tags are checked against `locales.available` in the settings module, like `s.locale()`. On a nullable enum, a second argument names the language of a URL that leaves the segment out, which only a router parameter may use:

  ```ts
  const urlLocale = s
    .enum("nb")
    .nullable()
    .locales({ nb: "nb-NO" }, { null: "en-US" });
  ```

  A router with a locale parameter makes each page a locale scope, so the Studio and validation know which language every page is in.

- **TanStack optional segments (`{-$param}`)** are now understood: route validation, `useValRoute` and the Studio's new-page form accept keys with and without the segment.
