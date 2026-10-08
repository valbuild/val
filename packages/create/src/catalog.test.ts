import {
  catalogUrl,
  fetchCatalog,
  isSafeRelativePath,
  parseCatalog,
  templateSource,
  templatesRef,
} from "./catalog";

/**
 * Reading `valbuild/templates`' catalog.
 *
 * Mostly about what is REFUSED, because the catalog arrives over the network
 * and its paths are deleted: a path that climbs out of the project has to be
 * stopped here, before `applyFeatures` ever sees it.
 */

/** An entry shaped like the real `catalog.json`'s. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "tanstack-full",
    framework: "tanstack",
    name: "Full",
    description: "A site to build on",
    path: "tanstack/full",
    icon: "catalog/icons/full.svg",
    screenshots: ["catalog/screenshots/tanstack-full-light.png"],
    features: {
      mcp: {
        paths: ["src/routes/api/mcp.ts", "src/val/mcp.server.ts"],
        dependencies: ["@valbuild/mcp", "sharp"],
        docs: ["README.md", "AGENTS.md"],
      },
      imageUploads: {
        file: "src/val/mcp.images.server.ts",
        dependencies: ["sharp"],
      },
    },
    regenerate: { script: "generate-routes", files: ["src/routeTree.gen.ts"] },
    ...overrides,
  };
}

const catalogOf = (...templates: unknown[]) => ({ version: 1, templates });

describe("parseCatalog", () => {
  it("reads the catalog the templates repository publishes", () => {
    const parsed = parseCatalog(catalogOf(entry()));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.catalog.templates[0]).toEqual({
      id: "tanstack-full",
      framework: "tanstack",
      name: "Full",
      description: "A site to build on",
      path: "tanstack/full",
      features: {
        mcp: {
          paths: ["src/routes/api/mcp.ts", "src/val/mcp.server.ts"],
          dependencies: ["@valbuild/mcp", "sharp"],
          docs: ["README.md", "AGENTS.md"],
        },
        imageUploads: {
          file: "src/val/mcp.images.server.ts",
          dependencies: ["sharp"],
        },
      },
      regenerate: {
        script: "generate-routes",
        files: ["src/routeTree.gen.ts"],
      },
    });
  });

  it("keeps the catalog's order, which is the order offered", () => {
    const parsed = parseCatalog(
      catalogOf(
        entry({ id: "tanstack-full" }),
        entry({ id: "tanstack-minimal", name: "Minimal" }),
      ),
    );
    expect(
      parsed.status === "ok" && parsed.catalog.templates.map((t) => t.id),
    ).toEqual(["tanstack-full", "tanstack-minimal"]);
  });

  it("skips a template for a framework this version does not know", () => {
    // How a newer catalog adds a framework without breaking older CLIs.
    const parsed = parseCatalog(
      catalogOf(entry(), entry({ id: "svelte-full", framework: "svelte" })),
    );
    expect(
      parsed.status === "ok" && parsed.catalog.templates.map((t) => t.id),
    ).toEqual(["tanstack-full"]);
  });

  it("refuses a version it cannot read, and says what to do", () => {
    const parsed = parseCatalog({ version: 2, templates: [entry()] });
    expect(parsed.status).toBe("error");
    expect(parsed.status === "error" && parsed.message).toContain("@latest");
  });

  it("refuses a feature path that climbs out of the project", () => {
    for (const path of [
      "../outside",
      "src/../../outside",
      ".",
      "src/.",
      "./src",
      "/etc/passwd",
      "C:/Windows",
      "src\\..\\..",
      "",
    ]) {
      const parsed = parseCatalog(
        catalogOf(
          entry({
            features: {
              mcp: { paths: [path], dependencies: [], docs: [] },
            },
          }),
        ),
      );
      expect(parsed.status).toBe("error");
    }
  });

  it("refuses a template path that climbs out of the repository", () => {
    expect(parseCatalog(catalogOf(entry({ path: "../x" }))).status).toBe(
      "error",
    );
  });

  it("refuses a features value that is not an object", () => {
    // Read as "no features", `--no-mcp` would remove nothing and say nothing.
    for (const features of ["mcp", ["mcp"], null]) {
      expect(parseCatalog(catalogOf(entry({ features }))).status).toBe("error");
    }
  });

  it("refuses image uploads without the endpoint that serves them", () => {
    const parsed = parseCatalog(
      catalogOf(
        entry({
          features: {
            imageUploads: { file: "src/val/images.ts", dependencies: [] },
          },
        }),
      ),
    );
    expect(parsed.status).toBe("error");
  });

  it("refuses a regenerate script that is more than a script name", () => {
    // It is run through a shell, after `<pm> run`.
    const parsed = parseCatalog(
      catalogOf(entry({ regenerate: { script: "x && curl evil", files: [] } })),
    );
    expect(parsed.status).toBe("error");
  });

  it("refuses a catalog with no template this version can create", () => {
    expect(parseCatalog(catalogOf()).status).toBe("error");
    expect(parseCatalog(catalogOf(entry({ framework: "svelte" }))).status).toBe(
      "error",
    );
  });

  it("allows a template with no optional features", () => {
    const parsed = parseCatalog(
      catalogOf(entry({ features: undefined, regenerate: undefined })),
    );
    expect(parsed.status === "ok" && parsed.catalog.templates[0].features) //
      .toEqual({});
  });
});

describe("isSafeRelativePath", () => {
  it("takes the paths templates use", () => {
    expect(isSafeRelativePath("src/routes/[.]well-known.ts")).toBe(true);
    expect(isSafeRelativePath("src/app/.well-known/x")).toBe(true);
  });
});

describe("where things come from", () => {
  it("reads the default branch unless VAL_TEMPLATES_REF says otherwise", () => {
    expect(templatesRef({})).toBe("HEAD");
    expect(templatesRef({ VAL_TEMPLATES_REF: "  " })).toBe("HEAD");
    expect(templatesRef({ VAL_TEMPLATES_REF: "my-branch" })).toBe("my-branch");
  });

  it("downloads the template's folder, from the same ref as the list", () => {
    const parsed = parseCatalog(catalogOf(entry()));
    if (parsed.status !== "ok") throw new Error("fixture");
    const template = parsed.catalog.templates[0];
    expect(templateSource(template, "HEAD")).toBe(
      "valbuild/templates/tanstack/full",
    );
    expect(templateSource(template, "my-branch")).toBe(
      "valbuild/templates/tanstack/full#my-branch",
    );
    expect(catalogUrl("my-branch")).toBe(
      "https://raw.githubusercontent.com/valbuild/templates/my-branch/catalog.json",
    );
  });
});

describe("fetchCatalog", () => {
  const respond =
    (status: number, body: unknown): typeof fetch =>
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      });

  it("returns the parsed catalog", async () => {
    const fetched = await fetchCatalog(
      "HEAD",
      respond(200, catalogOf(entry())),
    );
    expect(fetched.status).toBe("ok");
  });

  it("names the ref when a branch has no list", async () => {
    const fetched = await fetchCatalog("no-such-branch", respond(404, ""));
    expect(fetched.status === "error" && fetched.message).toContain(
      "VAL_TEMPLATES_REF",
    );
  });

  it("says GitHub could not be reached, rather than throwing", async () => {
    const fetched = await fetchCatalog("HEAD", async () => {
      throw new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com");
    });
    expect(fetched).toEqual({
      status: "error",
      message:
        "Could not reach GitHub to list the templates. Run the command again to try again.",
      details: "getaddrinfo ENOTFOUND raw.githubusercontent.com",
    });
  });

  it("says why a list it got could not be used", async () => {
    const fetched = await fetchCatalog(
      "HEAD",
      respond(200, catalogOf(entry({ path: "../x" }))),
    );
    expect(fetched.status === "error" && fetched.message).toContain(
      "tanstack-full",
    );
  });

  it("reports a body that is not JSON", async () => {
    const fetched = await fetchCatalog("HEAD", respond(200, "<html>"));
    expect(fetched.status).toBe("error");
  });
});
