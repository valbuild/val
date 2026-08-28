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

See the [documentation](https://val.build/docs) for more information.
