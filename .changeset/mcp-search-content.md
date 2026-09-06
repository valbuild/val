---
"@valbuild/mcp": minor
"@valbuild/shared": minor
"@valbuild/ui": patch
---

MCP: `search_content` — full-text search across the project's content, unpublished changes included.

The same index the Studio's search box uses, moved into `@valbuild/shared` so both run it, and built fresh on every call. That was the part that looked expensive and is not: indexing `valbuild/web`, a real production site of 20 modules and 206 KB of source, takes 162 ms, and it scales linearly from there — the 10 s default deadline is not reached until roughly 13 MB of content. Loading the modules costs more than indexing them, and every tool call already pays that.

It returns source paths, so `get_source` reads what it finds. Three arguments narrow or bound the work:

- `include` / `exclude` — module file path globs, e.g. `["/content/blogs/**"]`. `exclude` is applied after `include`.
- `timeoutMs` — stop indexing and answer with what has been indexed so far. The result then carries `timedOut`, the paths of the modules that were not reached, and a hint pointing at `include`.

Every answer says what it actually searched (`searched: { modules, of }`), so `total` can be read as a count over those modules rather than over the project. Modules you excluded are not reported as omissions — an omission always means the deadline, never your filter.
