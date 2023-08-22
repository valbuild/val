import meow from "meow";
import { error } from "./logger";
import { validate } from "./validate";
import { execSync } from "child_process";
import { error, info } from "./logger";
import { z } from "zod";
import { fileURLToPath } from "url";
import { debugPrint, error, info } from "./logger.js";
import { z } from "zod";
import confirm from "@inquirer/confirm";
//import open from "open";
import { runChecks } from "./utils/pre_config_check.js";
import installVal, {
  informUserOnEnvironmentVariables,
  informUserOnHowToPatchAppRoute,
} from "./utils/installVal.js";
import { input } from "@inquirer/prompts";

const VAL_URL = "http://localhost:3420";

function createInitUrl({
  projectName,
  valRootDir,
  repoName,
  repoOwner,
}: {
  projectName: string;
  valRootDir: string;
  repoName: string;
  repoOwner: string;
}) {
  return new URL(
    `/new/import?repo=${repoName}&owner=${repoOwner}&project_name=${projectName}&val_root=${valRootDir}&source=cli`,
    VAL_URL
  );
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
    case "pwd":
      return info(process.cwd());
    case "init": {
      runChecks();
      installVal();
      informUserOnHowToPatchAppRoute();
      const wantsValCloud = await confirm({
        message:
          "Would you like to set up Val Cloud? This is optional but enables the full CMS experience?",
      });
      if (wantsValCloud) {
        initValCloudProject();
        informUserOnEnvironmentVariables();
      }
      return error("Not implemented yet");
    }
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

const ownerAndRepoName = z.string().transform((val) => {
  const [owner, repo] = val.split("/");
  return { owner, repo };
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

function getPossibleGitRemoteUrls(remoteName?: string) {
  const remotes = getGitRemoteUrls();
  if (remotes === null) return null;
  const possibleRemotes = remotes.filter(
    ({ type, url, name }) =>
      type === "push" &&
      url &&
      (name === remoteName || remoteName === undefined) // if remoteName is undefined, then return all remotes
  );
  // happy with this one even though copilot gave me a hint
  const matchOwnerRepo = /github.com(?::|\/)([\w-]+)\/([\w-]+)\.git/g;

  // github.com - matches github.command
  // (?::|\/) - matches : or /
  // The ?: is a non-capturing group, it matches the group but doesn't capture it
  // ([\w-]+) - matches any word character (equal to [a-zA-Z0-9_]), + means one or more times
  // \/ - matches /
  // ([\w-]+) - matches any word character (equal to [a-zA-Z0-9_]), + means one or more times
  // \.git - matches .git
  // g - global flag, matches all occurences
  // Regex matches github.com/{owner}/{repo}.git and returns owner and repo

  const gurba = possibleRemotes.map((remote) => {
    const [owner, repoName] = z
      .string()
      .array()
      .min(3)
      .parse(Array.from(remote.url.matchAll(matchOwnerRepo))[0])
      .slice(1, 3);
    return { owner, repoName, remote: remote.name };
  });

  // todo safe parse or handle differently
  return gurba[0] ?? null;
}

async function initValCloudProject() {
  info("Initializing val project...");
  const __filename = fileURLToPath(import.meta.url); // Current filepath
  const currentDir = path.basename(path.dirname(__filename)); // Current directory name, just used as a default project name
  const possibleGitRemoteUrls = getPossibleGitRemoteUrls();

  // Collect input
  const projectName = projectNameSchema.parse(
    await input({
      message: "What is the name of your project?",
      default: currentDir,
    })
  );
  const valRootDir = await input({
    message: "What is the root directory of your Val project?",
    default: "./",
  });
  const remoteName = await input({
    message: "What is the name of your git remote?",
    default: possibleGitRemoteUrls?.remote ?? "origin",
  });
  const ownerAndRepo = ownerAndRepoName.parse(
    await input({
      message: "What is the owner and repo of your project?",
      default:
        ([getPossibleGitRemoteUrls(remoteName)] ?? [])
          .flatMap((remote) =>
            remote ? [`${remote.owner}/${remote.repoName}`] : []
          )
          .join("") ?? "owner/repo",
    })
  );
  // ----------------

  debugPrint("inputs done, lets create a url!");
  debugPrint(JSON.stringify(ownerAndRepo));
  const valUrl = createInitUrl({
    projectName,
    valRootDir,
    repoName: ownerAndRepo.repo,
    repoOwner: ownerAndRepo.owner,
  });
  // no org, then use username
  console.log("URL:", valUrl.toString());
  //await open(valUrl.toString());
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
