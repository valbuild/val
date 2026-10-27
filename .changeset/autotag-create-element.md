---
"@valbuild/react": patch
"@valbuild/tanstack": patch
---

Text rendered through `React.createElement` no longer keeps Val's invisible edit tag. TanStack Router's `<Link>` renders its link that way, so with content analytics on, the text of a link built from content carried the tag on every visitor's page.

New: `import "@valbuild/tanstack/autotag"` as the first import of `src/router.tsx`. Under `vite dev`, components whose modules ran before `@valbuild/tanstack` was imported were not click-to-edit, and the leak warning named their text as leaked. A production build was not affected.
