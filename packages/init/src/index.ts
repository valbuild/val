import meow from "meow";
import { init } from "./init";
import { error } from "./logger";

async function main() {
  const { flags } = meow(
    `
      Usage
        $ npx @valbuild/init
      Description
        Initialize Val in a project

      Options
        --help                   Show this message
        --root [root], -r [root] Set project root directory (default process.cwd())
        --yes [yes], -y [yes]    Accept all prompts with defaults.
    `,
    {
      flags: {
        root: {
          type: "string",
          alias: "r",
        },
        yes: {
          type: "boolean",
          alias: "y",
        },
      },
      hardRejection: false,
    }
  );

  await init(flags.root, { yes: flags.yes });
}

void main().catch((err) => {
  if (err.message.includes("force closed the prompt")) {
    process.exitCode = 2;
    return;
  }
  error(
    err instanceof Error
      ? err.message + "\n" + err.stack
      : typeof err === "object"
      ? JSON.stringify(err, null, 2)
      : err
  );
  process.exitCode = 1;
});
