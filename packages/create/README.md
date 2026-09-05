# @valbuild/create

Bootstrap a Val project from the CLI.

## Usage

```sh
npm create @valbuild@latest
# or
pnpm create @valbuild@latest
```

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

Two parts of the template are optional, and both default to yes.

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
