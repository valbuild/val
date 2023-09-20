import path from "path";
import meow from "meow";
import {
  createRequestHandler,
  createService,
  safeReadGit,
} from "@valbuild/server";
import { error, info } from "./logger";
import express from "express";
import cors from "cors";
import { createServer, Server } from "node:http";
import { LocalValServer } from "@valbuild/server";
import { validate } from "./validate";

async function serve({
  root,
  port,
  cfg,
}: {
  root?: string;
  port: number;
  cfg?: string;
}): Promise<void> {
  const projectRoot = root ? path.resolve(root) : process.cwd();
  const service = await createService(projectRoot, {
    valConfigPath: cfg ?? "./val.config",
  });
  const valReqHandler = createRequestHandler(
    new LocalValServer({
      service,
      git: await safeReadGit(projectRoot),
    })
  );
  const app = express();
  // TODO: Properly configure CORS
  app.use(cors(), valReqHandler);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  info(`Root is ${projectRoot}`);
  info(`Config is ${service.valConfigPath}`);
  info(`Listening on port ${port}`);

  let handled = false;
  const handleInterrupt: NodeJS.SignalsListener = async () => {
    if (handled) return;
    handled = true;

    info("Shutting down...");

    server.close((err) => {
      if (!err) return;
      error(err.toString());
    });
  };

  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);

  return new Promise((resolve) => {
    server.on("close", () => {
      service.dispose();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage
        $ val [command]
      Commands
        serve    Run val development server
        validate val-idate val modules

      Options
        --help                   Show this message
        --port [port], -p [port] Set server port (default 4123)
        --root [root], -r [root] Set project root directory (default process.cwd())
        --cfg  [cfg],  -c [cfg]  Set path to config relative to root (default ./val.config)
        --fix  [fix]             Attempt to fix validation errors
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
        cfg: {
          type: "string",
          alias: "c",
        },
        fix: {
          type: "boolean",
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
        cfg: flags.cfg,
      });
    case "validate":
    case "idate":
      return validate({
        root: flags.root,
        cfg: flags.cfg,
        fix: flags.fix,
      });
    default:
      return error(`Unknown command "${input.join(" ")}"`);
  }
}

void main().catch((err) => {
  error(
    err instanceof Error
      ? err.message + "\n" + err.stack
      : typeof err === "object"
      ? JSON.stringify(err, null, 2)
      : err
  );
  process.exitCode = 1;
});
