# @valbuild/create

Bootstrap a Val project from the cli.

## Usage

```sh
npm create @valbuild@latest
# or with a project name
npm create @valbuild@latest my-val-app
```

You'll be prompted to select a template (e.g. "starter" or "minimal").

## Options

- `-h`, `--help` Show help
- `-v`, `--version` Show version
- `--root <path>` Specify the root directory for project creation (default: current directory)

## Templates

- **starter**: Full-featured Next.js app with Val, TypeScript, Tailwind CSS, and examples
- **minimal**: Minimal Next.js app with Val and TypeScript

## Adding More Templates

To add more templates:

1. **Create a new public GitHub repo** under the `valbuild` org (e.g. `valbuild/template-nextjs-ecommerce`).
2. Add your template code to that repo.
3. In this CLI, open `src/index.ts` and add your template to the `TEMPLATES` array:

```ts
{
  name: "ecommerce",
  description: "E-commerce starter with Val and Next.js",
  repo: "valbuild/template-nextjs-ecommerce"
}
```

4. (Optional) Publish your template repo with a clear README and keep it up to date.

## Contributing

- PRs for new templates, bugfixes, or UX improvements are welcome!
- Please keep template names and descriptions clear and future-proof.
- For major changes, open an issue to discuss your idea first.

## License

MIT
