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

## Which framework

The first question is which framework to build on:

- **Next.js** — [`valbuild/template-nextjs-starter`](https://github.com/valbuild/template-nextjs-starter)
- **TanStack Start** — [`valbuild/template-tanstack-starter`](https://github.com/valbuild/template-tanstack-starter)

Answer it up front to skip the prompt:

```sh
pnpm create @valbuild@latest my-app --framework tanstack
pnpm create @valbuild@latest my-app --tanstack          # shorthand
pnpm create @valbuild@latest my-app --nextjs
```

`--framework` also takes `next`, `next.js` and `tanstack-start`, and the last
flag wins if you pass more than one.

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

Two parts of the template are optional, and both default to yes. They are asked
about only where the chosen starter has them — the TanStack Start starter does
not ship an MCP endpoint yet, so neither question is asked for it, and a
`--mcp` flag given anyway is turned off with a note rather than silently
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

See the [documentation](https://val.build/docs) for more information.
