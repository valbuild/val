import path from "path";
import { connectUrl, getGitHubOwnerAndRepo, repoFolder } from "./connect";

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

  test("in a monorepo, the app's folder goes with the repository", () => {
    const url = new URL(
      connectUrl("https://admin.val.build", {
        project: null,
        repo: { owner: "acme", repo: "monorepo" },
        folder: "apps/web",
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hosting: "own",
      repo: "acme/monorepo",
      folder: "apps/web",
    });
    // At the top of the repository there is no folder to send.
    expect(
      connectUrl("https://admin.val.build", {
        project: null,
        repo: { owner: "acme", repo: "site" },
        folder: "",
      }),
    ).toBe("https://admin.val.build/new?hosting=own&repo=acme%2Fsite");
  });

  test("the folder is the app's place in its repository, with forward slashes", () => {
    const top = path.resolve("/work/monorepo");
    expect(repoFolder(top, path.join(top, "apps", "web"))).toBe("apps/web");
    expect(repoFolder(top, top)).toBe("");
    expect(repoFolder(top, path.resolve("/elsewhere"))).toBe(null);
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
