import meow from "meow";
import { createValServer, createService } from "@valcms/server";
import { error, info } from "./logger";

async function serve({
  root,
  port,
}: {
  root?: string;
  port: number;
}): Promise<void> {
  const service = createService({
    rootDir: root ?? process.cwd(),
  });
  const server = await createValServer(service, {
    port,
  });
  info(`Listening on port ${server.port}`);

  let handled = false;
  const handleInterrupt: NodeJS.SignalsListener = async () => {
    if (handled) return;
    handled = true;

    info("Shutting down...");
    try {
      await server.close();
    } catch (err) {
      if (err instanceof Error) {
        error(err.toString());
      } else {
        error(err as string);
      }
    }
  };

  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);

  return new Promise((resolve) => {
    server.on("close", resolve);
  });
}

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage
        $ val [command]
      Commands
        serve    Run val development server

      Options
        --help                   Show this message
        --port [port], -p [port] Set server port (default 4123)
        --root [root], -r [root] Set project root directory (default process.cwd())
    `,
    {
      flags: {
        port: {
          type: "number",
          alias: "p",
          default: 4123,
        },
        root: {
          type: "string",
          alias: "r",
        },
      },
      hardRejection: false,
    }
  );

  if (input.length === 0) {
    return showHelp();
  }

  if (input.length !== 1) {
    return error(`Unknown command "${input.join(" ")}"`);
  }

  const [command] = input;
  switch (command) {
    case "serve":
      return serve({
        root: flags.root,
        port: flags.port,
      });
    default:
      return error(`Unknown command "${input.join(" ")}"`);
  }
}

void main().catch((err) => {
  error(err);
  process.exitCode = 1;
});
