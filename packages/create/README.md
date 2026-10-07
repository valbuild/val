# @valbuild/create

Bootstrap a Val project from the CLI.

## Usage

```sh
npm create @valbuild@latest
# or
pnpm create @valbuild@latest
```

Node `^22.13.0 || >=23.5.0` is required — 22.13 or newer on the 22 line, and
23.5 or newer after it, so Node 23.0 to 23.4 are **not** supported. The command
checks before it does anything else and tells you if this Node is not one of
them, because `engines` alone does not stop it: npm only warns, pnpm enforces
it only with `engine-strict`, and neither warning is visible in
`npm create` / `pnpm create` output.

### On Windows, quote the package name in PowerShell

```powershell
npm create "@valbuild@latest"
# or
pnpm create "@valbuild@latest"
```

Unquoted, PowerShell reads a leading `@` followed by a name as
[splatting](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_splatting)
— `@valbuild` expands to the variable `$valbuild`, which does not exist, so the
argument disappears before npm or pnpm sees it:

```
 ERR_PNPM_MISSING_ARGS  Missing the template package name.
```

cmd.exe, Git Bash, WSL and every shell on macOS and Linux pass `@valbuild`
through as written, so the quotes are only needed in PowerShell — but they are
harmless everywhere.

## Which template

The first questions are which framework to build on, then which template:

| Framework      | Template    | What it is                                                                    |
| -------------- | ----------- | ----------------------------------------------------------------------------- |
| TanStack Start | **Full**    | A site to build on: a theme editors can change, sections, light and dark mode |
| TanStack Start | **Minimal** | Val set up and nothing else: one example page, no CSS framework               |
| Next.js        | **Full**    | The same as TanStack's, on the App Router                                     |
| Next.js        | **Minimal** | The same as TanStack's, on the App Router                                     |

TanStack Start is offered first and is the default. The templates live in
[`valbuild/templates`](https://github.com/valbuild/templates), and that
repository's `catalog.json` is what is offered: the list is read when you run
the command, so a new template needs no new version of this package.

Answer up front to skip the prompts:

```sh
pnpm create @valbuild@latest my-app --template tanstack-full
pnpm create @valbuild@latest my-app --tanstack --template minimal
pnpm create @valbuild@latest my-app --framework nextjs --template full
```

`--template` takes a template's id (`tanstack-full`, which names the framework
too) or its name (`full`, `minimal`) within the framework. `--framework` takes
`tanstack` or `nextjs`, and also `next`, `next.js` and `tanstack-start`;
`--tanstack` and `--nextjs` are shorthands. The last flag wins if you pass more
than one.

To try a branch of the templates before it lands:

```sh
VAL_TEMPLATES_REF=my-branch pnpm create @valbuild@latest
```

## Package manager

The new project is installed with the package manager that ran the command, so
`pnpm create` gives you a pnpm project (`pnpm-lock.yaml`, `pnpm run dev`) and
`npm create` an npm one. yarn and bun are detected the same way.

To choose the package manager yourself, pass one of:

```sh
npm create @valbuild@latest -- --use-pnpm
npm create @valbuild@latest -- --package-manager pnpm   # same thing, spelled out
```

`--use-npm`, `--use-pnpm`, `--use-yarn` and `--use-bun` are all accepted.

The project name can be given as an argument instead of answering the prompt:

```sh
pnpm create @valbuild@latest my-app
```

## Features it asks about

Two parts of the template are optional, and both default to yes. Every
template has both today; a template that lacks one is not asked about it, and a
flag that asks for it anyway is turned off with a note rather than silently
producing a project whose endpoint is not there.

- **MCP.** Serves Val's content tools at `/api/mcp`, so a coding agent can read
  your schemas, look content up, validate it and edit it. The endpoint refuses
  to serve on a deployed host in local filesystem mode, so having it costs a
  project nothing until it is configured for it.
- **Image uploads.** An `upload_image` tool on that endpoint. Separate because
  it needs [`sharp`](https://sharp.pixelplumbing.com), which ships a compiled
  binary per platform — worth having, but not worth installing in a project
  that will never upload an image.

Both can be answered up front, which is what a scripted setup wants:

```sh
pnpm create @valbuild@latest my-app --mcp --no-image-uploads
pnpm create @valbuild@latest my-app --no-mcp
```

`--image-uploads` without an MCP endpoint to serve it on is turned off with a
note rather than refused; giving a flag both ways (`--mcp --no-mcp`) is an
error.

Which files, dependencies and README sections a declined feature takes with it
is the template's to say, in the catalog — so it is always exactly what that
template has. Generated files that pointed at them (TanStack's route tree) are
regenerated after the install.

See the [documentation](https://val.build/docs) for more information.
