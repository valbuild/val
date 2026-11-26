---
"@valbuild/server": patch
---

`@valbuild/server/internal` exports `foldContent`, which writes each module's recorded content back into a project's `.val.ts` files (and a `.jsonValues()` record's `.val.json` entries) the way a save writes them, then checks that every module reads back exactly as recorded. It is what Val Build needs to connect a project it hosts to a repository. A content change Val cannot write into the code that builds it is refused by name.

Also: a merge whose content cannot be written into a file now says why, instead of `[object Object]`, and a project loaded for a merge whose `tsconfig.json` names its inputs by `include` glob now loads.
