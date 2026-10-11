/**
 * The GitHub repository `origin` points at, from `git remote -v`
 * (`origin\tgit@github.com:acme/site.git (fetch)`, or the `ssh://` or
 * `https://` form). Null when origin is not on github.com itself.
 */
export function gitHubOwnerAndRepo(
  remotes: string,
): { owner: string; repo: string } | null {
  for (const line of remotes.split("\n")) {
    const match = line.match(
      /^origin\s+(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/\s]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/,
    );
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}
