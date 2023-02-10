import path from "path";
import meow from "meow";
import {
  createRequestHandler,
  createService,
  fp,
  result,
  validateValModule,
  ValModuleResolver,
} from "@valbuild/server";
import { error, info } from "./logger";
import express from "express";
import cors from "cors";
import { createServer, Server } from "node:http";
import ts from "typescript";

async function serve({
  root,
  port,
  cfg,
}: {
  root?: string;
  port: number;
  cfg?: string;
}): Promise<void> {
  const resolver = new ValModuleResolver(
    root ? path.resolve(root) : process.cwd()
  );
  const service = await createService(resolver, {
    valConfigPath: cfg ?? "./val.config",
  });
  const valReqHandler = createRequestHandler(service);
  const app = express();
  // TODO: Properly configure CORS
  app.use(cors(), valReqHandler);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  info(`Root is ${resolver.projectRoot}`);
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

async function validate({
  root,
  cfg = "./val.config",
}: {
  root?: string;
  cfg?: string;
}): Promise<void> {
  const resolver = new ValModuleResolver(
    root ? path.resolve(root) : process.cwd()
  );

  const valModulePaths = resolver.getValModulePaths(cfg);

  const validation = result.allV(
    valModulePaths.map((valModulePath) =>
      fp.pipe(
        resolver.getSourceFile(valModulePath),
        result.fromPredicate(
          (sourceFile): sourceFile is ts.SourceFile => sourceFile !== undefined,
          () => "Unable to get source file"
        ),
        result.flatMap(validateValModule),
        result.mapErr((error: string) => `${valModulePath}:\n${error}`)
      )
    )
  );
  if (result.isErr(validation)) {
    throw Error(validation.error.join("\n\n"));
  }
}

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage
        $ val [command]
      Commands
        serve       Run val development server
        validate    val-idate val modules

      Options
        --help                   Show this message
        --port [port], -p [port] Set server port (default 4123)
        --root [root], -r [root] Set project root directory (default process.cwd())
        --cfg  [cfg],  -c [cfg]  Set path to config relative to root (default ./val.config)
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
      });
    default:
      return error(`Unknown command "${input.join(" ")}"`);
  }
}

void main().catch((err) => {
  error(err);
  process.exitCode = 1;
});
