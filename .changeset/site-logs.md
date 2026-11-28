---
"@valbuild/cli": minor
"@valbuild/mcp": minor
"@valbuild/server": minor
---

See what your hosted site's server did in the last hour, request by request.
Val Build now keeps every request a hosted site served for an hour — its path,
status, how long it took, how it ended and every line it printed. The Studio
shows them under Logs in the account panel; two more things read them:

- **`val logs`** prints them oldest first, each with the lines it printed
  under it. `-f` follows: new requests appear as they come (it can take up to a
  minute for them to start). `--since 30m`, `--level error,warn` and
  `--search "status:5xx path:/blog/*"` narrow it, `--json` gives Val Build's
  answer as is, and `--verbose` adds stacks. It uses your `val login`, or
  `VAL_API_KEY`, like `val errors`.
- **The MCP tool `get_logs`**, so an agent can see what happened on the
  request that failed, not only that something did.

The search takes words and filters: `status:5xx`, `status:404`, `path:/blog/*`,
`method:post`, `level:error`, `build:live` and `is:stopped`. Secrets, tokens
and query strings are taken out before anything is kept.
