import meow from "meow";
import { error } from "./logger";
import { validate } from "./validate";
import { files as files } from "./files";

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage:
        $ val [command]
      
      Options:
        --help                   Show this message
      
      Commands:
        validate
        list-files
      
      Command: validate
      Description: val-idate val modules
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())
        --cfg  [cfg],  -c [cfg]  Set path to config relative to root (default ./val.config)
        --fix  [fix]             Attempt to fix validation errors
        --noEslint [noEslint]    Disable eslint validation during validate


      Command: files
      Description: EXPERIMENTAL.
        Perform file operations in Val.
        By default it lists files (images, ...) currently in use by Val. 

        If a managed directory is specified, 
        it will list all files in the managed directory that ARE NOT currently used by Val.
        This is useful for cleaning up unused files.
      Options:
        --managedDir [dir]      If set, list files found in directory that are not managed by Val
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
        fix: {
          type: "boolean",
        },
        noEslint: {
          type: "boolean",
        },
        managedDir: {
          type: "string",
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
    case "files":
      if (flags.fix || flags.noEslint) {
        return error(
          `Command "files" does not support --fix or --noEslint flags`
        );
      }
      return files({
        root: flags.root,
        cfg: flags.cfg,
        managedDir: flags.managedDir,
      });
    case "validate":
    case "idate":
      if (flags.managedDir) {
        return error(`Command "validate" does not support --managedDir flag`);
      }
      return validate({
        root: flags.root,
        cfg: flags.cfg,
        fix: flags.fix,
        noEslint: flags.noEslint,
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
