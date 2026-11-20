---
"@valbuild/cli": minor
"@valbuild/mcp": minor
"@valbuild/server": minor
"@valbuild/ui": minor
---

See what your hosted site's server is throwing. Val Build now keeps the errors
and warnings of sites it hosts — uncaught exceptions, `console.error` and
`console.warn`, requests stopped for using too much CPU or memory, and 5xx
responses — grouped, for 7 days, with which ones the build that is live now
brought. Three ways to read them:

- **In the Studio**, under Deployments in the account panel, for a project on
  Hosted.
- **`val errors`** prints them for the project in `val.config`, newest first.
  `--verbose` adds stacks, `--json` gives Val Build's answer as is, and
  `--limit` caps how many. It uses your `val login`, or `VAL_API_KEY`.
- **The MCP tool `get_site_errors`**, so an agent asked why a page is broken
  can read what the server said.

Secrets, tokens and query strings are taken out before anything is kept, and
`console.log` is not kept at all.
