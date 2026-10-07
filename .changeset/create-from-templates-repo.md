---
"@valbuild/create": minor
---

`npm create @valbuild` now creates projects from [`valbuild/templates`](https://github.com/valbuild/templates), and asks which template you want as well as which framework:

- **Full** — a site to build on: a theme editors can change in Val Studio, a set of sections, light and dark mode, and Storybook.
- **Minimal** — Val set up and nothing else: one example page you can delete, and no CSS framework.

Both are available for TanStack Start and Next.js. TanStack Start is now offered first and is the default. Every template includes Val's MCP endpoint, which you can still decline; TanStack Start projects get it too, which the old starter did not have.

Answer up front with `--template`:

```sh
pnpm create @valbuild@latest my-app --template tanstack-full
pnpm create @valbuild@latest my-app --nextjs --template minimal
```

The list of templates is read from the templates repository when you run the command, so new templates show up without a new version of `@valbuild/create`. Set `VAL_TEMPLATES_REF` to a branch of `valbuild/templates` to try one before it lands.
