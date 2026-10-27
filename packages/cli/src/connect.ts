import pc from "picocolors";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { findAndEvalValConfigFile } from "./utils/evalValConfigFile";

const host = process.env.VAL_BUILD_URL || "https://admin.val.build";

/**
 * `val connect`: opens admin's `/new` on "your own hosting", with what it can
 * tell from here filled in -- the project `val.config.ts` names, the GitHub
 * repository `origin` points at, and which folder of it this app is in (a
 * monorepo has several) -- so the person only confirms. The link is printed
 * too, for when no browser opens (over SSH, in a container).
 */
export async function connect(options: { root?: string }) {
  const { root } = options;
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const project = await tryGetProject(projectRoot);
  const git = findGitDir(projectRoot);
  const gitRemote = git ? await tryGetGitRemote(git.config) : null;
  const repo = gitRemote !== null ? getGitHubOwnerAndRepo(gitRemote) : null;
  const folder = git ? repoFolder(git.top, projectRoot) : null;

  console.log("");
  if (project) {
    console.log(
      `Found ${pc.bold(`${project.orgName}/${project.projectName}`)} in val.config.ts`,
    );
  }
  if (repo) {
    console.log(
      `Found ${pc.bold(`${repo.owner}/${repo.repo}`)} on GitHub (git remote "origin")${folder ? `, this app in ${pc.bold(folder)}` : ""}`,
    );
  } else {
    console.log(
      pc.dim(
        "No GitHub repository found: push this project to GitHub, or pick or create one in the browser.",
      ),
    );
  }

  const url = connectUrl(host, { project, repo, folder });
  const opened = openInBrowser(url);
  console.log(
    `\n${opened ? "Finish in your browser. If it did not open, go to:" : "Finish in your browser:"}\n${pc.cyan(url)}\n`,
  );
}

/**
 * Where `val connect` sends the person: `/new` on "your own hosting"
 * (`hosting=own`), with the repository and the project's names when they are
 * known. Older CLIs go to `/connect`, which redirects here.
 */
export function connectUrl(
  host: string,
  found: {
    project: { orgName: string; projectName: string } | null;
    repo: { owner: string; repo: string } | null;
    /** The app's folder in the repository, `apps/web`; "" or null at the top. */
    folder?: string | null;
  },
): string {
  const params = new URLSearchParams({ hosting: "own" });
  if (found.repo) {
    params.set("repo", `${found.repo.owner}/${found.repo.repo}`);
    if (found.folder) params.set("folder", found.folder);
  }
  if (found.project) {
    params.set("org", found.project.orgName);
    params.set("project", found.project.projectName);
  }
  return `${host.replace(/\/+$/, "")}/new?${params.toString()}`;
}

/**
 * Opens `url` in the default browser, without waiting for it. False when
 * there is clearly none to open (CI, no terminal), so the caller can say so;
 * a browser that fails to start later is covered by the printed link.
 */
function openInBrowser(url: string): boolean {
  if (process.env.CI || !process.stdout.isTTY) return false;
  const windows = process.platform === "win32";
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : windows
        ? // `start` is a cmd built-in: its first quoted argument is a window
          // title, and `&` would end the command unless escaped.
          ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: windows,
    });
    child.on("error", () => {
      // No opener installed: the printed link is the way in.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function tryGetProject(projectRoot: string): Promise<{
  orgName: string;
  projectName: string;
} | null> {
  const valConfigFile = await findAndEvalValConfigFile(projectRoot);

  if (valConfigFile && valConfigFile.project) {
    const parts = valConfigFile.project.split("/");
    if (parts.length === 2) {
      return {
        orgName: parts[0],
        projectName: parts[1],
      };
    } else {
      console.error(
        pc.red(
          `Invalid project format in val.config file: "${valConfigFile.project}". Expected format "orgName/projectName".`,
        ),
      );
      process.exit(1);
    }
  }
  return null;
}

/**
 * The GitHub repository a remote URL names: `git@github.com:acme/site.git`,
 * `ssh://git@github.com/acme/site.git` or `https://[user@]github.com/acme/site`.
 * Null for any other host.
 */
export function getGitHubOwnerAndRepo(
  gitRemote: string,
): { owner: string; repo: string } | null {
  const match = gitRemote
    .trim()
    .match(
      /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/\s]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
    );
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * Where the app is in its repository, with forward slashes: `apps/web`, or ""
 * when it is at the top. Null when it is not inside the repository at all.
 */
export function repoFolder(top: string, projectRoot: string): string | null {
  const relative = path.relative(top, projectRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

async function tryGetGitRemote(gitConfigPath: string): Promise<string | null> {
  try {
    const gitConfig = fs.readFileSync(gitConfigPath, "utf-8");
    const remoteMatch = gitConfig.match(
      /\[remote "origin"\][\s\S]*?url = (.+)/,
    );
    if (remoteMatch && remoteMatch[1]) {
      return remoteMatch[1].trim();
    }
    return null;
  } catch (error) {
    console.error(pc.red("Failed to read .git/config file."), error);
    return null;
  }
}

/** The repository `root` is in: its top folder and its `.git/config`. */
function findGitDir(root: string): { top: string; config: string } | null {
  let currentDir = root;
  let lastDir = null;
  while (currentDir !== lastDir) {
    const gitConfigPath = path.join(currentDir, ".git", "config");
    if (fs.existsSync(gitConfigPath)) {
      return { top: currentDir, config: gitConfigPath };
    }
    lastDir = currentDir;
    currentDir = path.dirname(currentDir);
    if (lastDir === currentDir) {
      break;
    }
  }
  return null;
}
