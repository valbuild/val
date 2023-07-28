import meow from "meow";
import { error } from "./logger";
import { validate } from "./validate";
import { execSync } from "child_process";
import { error, info } from "./logger";
import { prompt } from "enquirer";
import { z } from "zod";
import fs from "fs";

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
        --noEslint [noEslint]    Disable eslint validation
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
    case "validate":
    case "idate":
      return validate({
        root: flags.root,
        cfg: flags.cfg,
        fix: flags.fix,
        noEslint: flags.noEslint,
      });
    case "init":
      initValProject();
      return error("Not implemented yet");
    default:
      return error(`Unknown command "${input.join(" ")}"`);
  }
}
// add same validdation as in web app
// no space allowed
const projectNameSchema = z
  .string()
  .max(50)
  .min(3)
  .regex(/^[a-zA-Z0-9_-]*$/);
// this reges works like this(thank you copilot):
// ^ - start of string
// [a-zA-Z0-9_-] - any character from a-z, A-Z, 0-9, _ or -
// * - zero or more times
// $ - end of string
// so this regex allows only strings that contain only characters from a-z, A-Z, 0-9, _ or -

// valid file path
const valRootDirSchema = z.string().refine((val) => {
  try {
    fs.accessSync(val);
    return true;
  } catch {
    return false;
  }
}, "Invalid file path");

const valConfigSchema = z.object({
  projectName: projectNameSchema,
  valRootDir: valRootDirSchema,
  ownerAndRepo: z.string().transform((val) => {
    const [owner, repo] = val.split("/");
    return { owner, repo };
  }),
});

function getGitRemoteUrls() {
  try {
    const remotes = execSync("git remote -v", { encoding: "utf-8" });
    const parsedRemotes = remotes
      .trim()
      .split("\n")
      .map((remote) => {
        const [name, urlWithType] = remote.split("\t");
        const [url, type] = urlWithType.split(" ");
        return { name, url, type: type.replace(/[()]/g, "") };
      });
    return parsedRemotes.length > 0 ? parsedRemotes : null;
  } catch (error) {
    console.error("Failed to get git remote URLs:", error);
    return null;
  }
}

function getPossibleGitRemoteUrls() {
  const remotes = getGitRemoteUrls();
  if (remotes === null) return [];
  const possibleRemotes = remotes.filter(
    (remote) => remote.type === "push" && remote.url
  );
  // happy with this one even though copilot gave me a hint
  const matchOwnerRepo = /github.com(?::|\/)([\w-]+)\/([\w-]+)\.git/g;
  // rewrite this
  const gurba = possibleRemotes.map((remote) => {
    const [owner, repoName] = z
      .string()
      .array()
      .min(3)
      .parse(Array.from(remote.url.matchAll(matchOwnerRepo))[0])
      .slice(1, 3);
    return { owner, repoName };
  });

  return gurba;
}

console.log(getGitRemoteUrls());
console.log(getPossibleGitRemoteUrls());
async function initValProject() {
  info("Initializing val project...");
  const valConfig = await valConfigSchema.promise().parse(
    prompt([
      {
        type: "input",
        name: "projectName",
        message: "What is the name of your project?",
      },
      {
        type: "input",
        name: "valRootDir",
        message: "What is the root directory of your Val project?",
        initial: "./",
      },
      {
        type: "input",
        name: "gitRemote",
        message: "What is the name of your git remote?",
        initial: "./",
      },
      {
        type: "input",
        name: "ownerAndRepo",
        message: "What is the owner and repo of your project?",
        initial: getPossibleGitRemoteUrls()
          .map((remote) => `${remote.owner}/${remote.repoName}`)
          .join(", "),
      },
    ])
  );
  console.log(valConfig);
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
