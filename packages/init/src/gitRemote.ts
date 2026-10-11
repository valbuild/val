/**
 * The GitHub repository `origin` points at, from `git remote -v`
 * (`origin\tgit@github.com:acme/site.git (fetch)` or the https form). Null
 * when origin is not on GitHub.
 */
export function gitHubOwnerAndRepo(
  remotes: string,
): { owner: string; repo: string } | null {
  const origin = remotes
    .split("\n")
    .find((line) => line.startsWith("origin\t") || line.startsWith("origin "));
  const match = origin?.match(
    /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/,
  );
  return match ? { owner: match[1], repo: match[2] } : null;
}
