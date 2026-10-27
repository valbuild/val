---
"@valbuild/server": patch
"@valbuild/ui": patch
---

The assistant can search, format and typecheck a proposal's code, and change content in the design tab.

- **`search_code`** finds every line of the project that matches some text or a regular expression, with its file and line number, so the assistant finds where something is rendered before reading whole files.
- **`format_files`** formats the proposal's files with Prettier and the project's own config (`.prettierrc`, `.prettierrc.json` or `package.json`'s `prettier`), and stages the ones that change. It runs in the browser, loaded the first time it is used, because the platform's server cannot run Prettier. A config it cannot read — JavaScript, YAML, plugins or per-file overrides — is reported rather than guessed at.
- **`typecheck`** checks the proposal's code with TypeScript and answers the type errors the proposal adds — not the ones the site already has. The assistant runs it after changing code and before building. In the design tab its result is the Types check.
- **`create_patch` in the design tab** writes content into the module's file in the proposal and stages it with the code, so a field the assistant adds to a schema is filled in the same change and built with it.
