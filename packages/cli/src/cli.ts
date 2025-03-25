import meow from "meow";
import { error } from "./logger";
import { validate } from "./validate";
import { files as files } from "./files";
import { getVersions } from "./getVersions";
import chalk from "chalk";
import { login } from "./login";

async function main(): Promise<void> {
  const { input, flags, showHelp } = meow(
    `
      Usage:
        $ val [command]
      
      Options:
        --help                   Show this message
      
      Commands:
        validate
        login
        list-files
        versions
      
      Command: validate
      Description: val-idate val modules
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())
        --fix  [fix]             Attempt to fix validation errors
        --noEslint [noEslint]    Disable eslint validation during validate

      
      Command: login
      Description: login to app.val.build and generate a Personal Access Token
      Options:
        --root [root], -r [root] Set project root directory (default process.cwd())


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
    },
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
          `Command "files" does not support --fix or --noEslint flags`,
        );
      }
      return files({
        root: flags.root,
        managedDir: flags.managedDir,
      });
    case "versions":
      return versions();
    case "login":
      return login({
        root: flags.root,
      });
    case "validate":
    case "idate":
      if (flags.managedDir) {
        return error(`Command "validate" does not support --managedDir flag`);
      }
      return validate({
        root: flags.root,
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
        : err,
  );
  process.exitCode = 1;
});

async function versions() {
  const foundVersions = getVersions();
  console.log(`${chalk.cyan("@valbuild/core")}: ${foundVersions.coreVersion}`);
  console.log(`${chalk.cyan("@valbuild/next")}: ${foundVersions.nextVersion}`);
}
