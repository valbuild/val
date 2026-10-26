---
"@valbuild/ui": minor
---

Set a hosted project's variables and secrets from the Studio: **Settings › Variables**.

The tab shows Val Build's own `<val-env-vars>` for a project connected to Val Build, the same panel as the project's **Variables** page in Val Build:

- **Variables** are configuration, such as an API's address or a feature flag. Their values are shown and edited in place. Names starting with `PUBLIC_` reach the browser as `import.meta.env.NAME`; every variable is `process.env.NAME` on the server.
- **Secrets** are credentials. A secret is sealed in the browser it is typed into before it is sent, and nobody can read it back. On the server it is `process.env.NAME`; it never reaches the browser.

A change is live on the site within a minute, with no build. Owners and developers can change them; everyone in the project can see the variables and the secrets' names. A project on its own hosting is told to set them at its host.
