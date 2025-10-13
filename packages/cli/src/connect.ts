import pc from "picocolors";
import fs from "fs";
import path from "path";
import { evalValConfigFile } from "./utils/evalValConfigFile";
import { exec } from "child_process";

const host = process.env.VAL_BUILD_URL || "https://admin.val.build";

export async function connect(options: { root?: string }) {
  const { root } = options;
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const maybeProject = await tryGetProject(projectRoot);
  const maybeGitRemote = await tryGetGitRemote(projectRoot);
  const maybeGitOwnerAndRepo =
    maybeGitRemote !== null ? getGitHubOwnerAndRepo(maybeGitRemote) : null;

  const params = new URLSearchParams();
  if (maybeProject) {
    params.set("org", maybeProject.orgName);
    params.set("project", maybeProject.projectName);
  }
  if (maybeGitOwnerAndRepo) {
    params.set(
      "github_repo",
      [maybeGitOwnerAndRepo.owner, maybeGitOwnerAndRepo.repo].join("/"),
    );
  }
  const url = `${host}/connect?${params.toString()}`;

  // Open url in default browser and show fallback instructions:
  console.log(pc.cyan("\nStarting connect process in browser...\n"));
  console.log(
    pc.dim(`\nIf the browser does not open, please visit:\n${url}\n`),
  );

  if (process.platform === "win32") {
    // Windows
    exec(`start ${url}`);
  } else if (process.platform === "darwin") {
    // macOS
    exec(`open ${url}`);
  } else {
    // Linux and others
    exec(`xdg-open ${url}`);
  }
}

async function tryGetProject(projectRoot: string): Promise<{
  orgName: string;
  projectName: string;
} | null> {
  const valConfigFile =
    (await evalValConfigFile(projectRoot, "val.config.ts")) ||
    (await evalValConfigFile(projectRoot, "val.config.js"));

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

function getGitHubOwnerAndRepo(
  gitRemote: string,
): { owner: string; repo: string } | null {
  const sshMatch = gitRemote.match(/git@github\.com:(.+?)\/(.+?)(\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  const httpsMatch = gitRemote.match(
    /https:\/\/github\.com\/(.+?)\/(.+?)(\.git)?$/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

async function tryGetGitRemote(root: string): Promise<string | null> {
  try {
    const gitConfig = tryGetGitConfig(root);
    if (!gitConfig) {
      return null;
    }
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

function tryGetGitConfig(root: string): string | null {
  let currentDir = root;
  let lastDir = null;
  while (currentDir !== lastDir) {
    const gitConfigPath = path.join(currentDir, ".git", "config");
    if (fs.existsSync(gitConfigPath)) {
      return fs.readFileSync(gitConfigPath, "utf-8");
    }
    lastDir = currentDir;
    currentDir = path.dirname(currentDir);
    if (lastDir === currentDir) {
      break;
    }
  }
  return null;
}
