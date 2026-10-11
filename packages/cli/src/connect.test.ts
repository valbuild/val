import { connectUrl, getGitHubOwnerAndRepo } from "./connect";

describe("val connect", () => {
  test("opens /new on your own hosting, with the repository and the project filled in", () => {
    const url = new URL(
      connectUrl("https://admin.val.build", {
        project: { orgName: "acme", projectName: "website" },
        repo: { owner: "acme-gh", repo: "site" },
      }),
    );
    expect(url.origin + url.pathname).toBe("https://admin.val.build/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hosting: "own",
      repo: "acme-gh/site",
      org: "acme",
      project: "website",
    });
  });

  test("with nothing found, it is /new on your own hosting alone", () => {
    expect(
      connectUrl("http://localhost:3000/", { project: null, repo: null }),
    ).toBe("http://localhost:3000/new?hosting=own");
  });

  test("the repository is read from origin over ssh or https", () => {
    expect(getGitHubOwnerAndRepo("git@github.com:acme/site.git")).toEqual({
      owner: "acme",
      repo: "site",
    });
    expect(getGitHubOwnerAndRepo("https://github.com/acme/site")).toEqual({
      owner: "acme",
      repo: "site",
    });
    expect(getGitHubOwnerAndRepo("ssh://git@github.com/acme/site.git")).toEqual(
      { owner: "acme", repo: "site" },
    );
    expect(
      getGitHubOwnerAndRepo("https://me@github.com/acme/site.git"),
    ).toEqual({ owner: "acme", repo: "site" });
    // Host names are case-insensitive.
    expect(getGitHubOwnerAndRepo("https://GitHub.com/acme/site.git")).toEqual({
      owner: "acme",
      repo: "site",
    });
    expect(getGitHubOwnerAndRepo("git@gitlab.com:acme/site.git")).toBeNull();
    expect(getGitHubOwnerAndRepo("git@notgithub.com:acme/site.git")).toBeNull();
  });
});
