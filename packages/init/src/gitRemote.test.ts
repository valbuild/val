import { gitHubOwnerAndRepo } from "./gitRemote";

describe("the GitHub repository origin points at", () => {
  test("over ssh and https, with or without .git", () => {
    expect(
      gitHubOwnerAndRepo(
        "origin\tgit@github.com:acme/site.git (fetch)\norigin\tgit@github.com:acme/site.git (push)\n",
      ),
    ).toEqual({ owner: "acme", repo: "site" });
    expect(
      gitHubOwnerAndRepo(
        "origin\thttps://github.com/acme/my.site (fetch)\norigin\thttps://github.com/acme/my.site (push)\n",
      ),
    ).toEqual({ owner: "acme", repo: "my.site" });
  });

  test("origin, not another remote", () => {
    expect(
      gitHubOwnerAndRepo(
        "fork\tgit@github.com:me/site.git (fetch)\norigin\tgit@github.com:acme/site.git (fetch)\n",
      ),
    ).toEqual({ owner: "acme", repo: "site" });
  });

  test("none when origin is not on GitHub, or there is no origin", () => {
    expect(
      gitHubOwnerAndRepo("origin\tgit@gitlab.com:acme/site.git (fetch)\n"),
    ).toBeNull();
    expect(gitHubOwnerAndRepo("")).toBeNull();
  });
});
