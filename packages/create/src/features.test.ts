import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CatalogFeatures } from "./catalog";
import { applyFeatures } from "./features";

/**
 * Taking the declined features back out of a downloaded template.
 *
 * Written against a directory shaped like the real template rather than a
 * mock, because every failure this can have is about a path or a key being
 * slightly different from the one that is actually there — and a mock built
 * from the same assumptions as the code would agree with it either way.
 */

/**
 * What `valbuild/templates`' catalog says about the Next.js templates. The
 * paths are the template's to name; these are the ones it names.
 */
const NEXT_FEATURES: CatalogFeatures = {
  mcp: {
    paths: [
      "src/app/api/mcp",
      "src/app/.well-known/oauth-protected-resource",
      "src/val/mcp.ts",
      "src/val/mcp.images.ts",
    ],
    dependencies: [
      "@valbuild/mcp",
      "@modelcontextprotocol/server",
      "mcp-handler",
      "zod",
      "sharp",
    ],
    docs: ["README.md", "AGENTS.md"],
  },
  imageUploads: { file: "src/val/mcp.images.ts", dependencies: ["sharp"] },
};

/** The parts of a Next.js template these functions touch. */
function writeTemplate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-create-test"));
  const write = (relativePath: string, contents: string) => {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  };
  write("src/val/mcp.ts", "// the endpoint\n");
  write("src/val/mcp.images.ts", "// sharp lives here\n");
  write("src/val/val.server.ts", "// the Studio's own route\n");
  write("src/app/api/mcp/route.ts", "// the transport\n");
  write(
    "src/app/.well-known/oauth-protected-resource/route.ts",
    "// rfc9728\n",
  );
  write("src/app/(val)/api/val/[[...val]]/route.ts", "// the Studio\n");
  write(
    "package.json",
    `${JSON.stringify(
      {
        name: "my-app",
        dependencies: {
          "@modelcontextprotocol/server": "^2.0.0",
          "@valbuild/core": "0.121.0",
          "@valbuild/mcp": "0.121.0",
          "@valbuild/next": "0.121.0",
          "mcp-handler": "^2.1.1",
          next: "16.3.3",
          sharp: "^0.35.4",
          zod: "^4.4.3",
        },
        devDependencies: { "@valbuild/cli": "0.121.0" },
      },
      null,
      2,
    )}\n`,
  );
  write(
    "README.md",
    [
      "# my-app",
      "",
      "Intro.",
      "",
      "<!-- val:mcp:start -->",
      "",
      "## Coding agents (MCP)",
      "",
      "How to attach one.",
      "",
      "<!-- val:mcp:end -->",
      "",
      "## Package manager",
      "",
      "npm and pnpm both work.",
      "",
    ].join("\n"),
  );
  return root;
}

function readPackageJson(root: string): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
}

const exists = (root: string, relativePath: string) =>
  fs.existsSync(path.join(root, relativePath));

describe("everything on", () => {
  it("changes nothing", () => {
    const root = writeTemplate();
    const before = readPackageJson(root);

    applyFeatures(root, { mcp: true, imageUploads: true }, NEXT_FEATURES);

    expect(readPackageJson(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root, "src/val/mcp.images.ts"), "utf-8")) //
      .toBe("// sharp lives here\n");
    expect(exists(root, "src/app/api/mcp/route.ts")).toBe(true);
  });
});

describe("image uploads declined", () => {
  it("replaces the image tools with an empty list and drops sharp", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: true, imageUploads: false }, NEXT_FEATURES);

    const contents = fs.readFileSync(
      path.join(root, "src/val/mcp.images.ts"),
      "utf-8",
    );
    expect(contents).toContain(
      "export const valImageTools: ValToolImpl[] = []",
    );
    // The file stays, and says how to turn the feature on: finding out it was
    // ever an option should not need this package's source.
    expect(contents).toContain("sharpImageProcessor");
    expect(readPackageJson(root).dependencies).not.toHaveProperty("sharp");
  });

  it("keeps the endpoint itself", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: true, imageUploads: false }, NEXT_FEATURES);

    expect(exists(root, "src/val/mcp.ts")).toBe(true);
    expect(exists(root, "src/app/api/mcp/route.ts")).toBe(true);
    expect(readPackageJson(root).dependencies).toHaveProperty("@valbuild/mcp");
    expect(fs.readFileSync(path.join(root, "README.md"), "utf-8")).toContain(
      "Coding agents (MCP)",
    );
  });
});

describe("MCP declined", () => {
  it("removes the endpoint, the transport and the discovery document", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    expect(exists(root, "src/val/mcp.ts")).toBe(false);
    expect(exists(root, "src/val/mcp.images.ts")).toBe(false);
    expect(exists(root, "src/app/api")).toBe(false);
    expect(exists(root, "src/app/.well-known")).toBe(false);
  });

  it("leaves the Studio's own route and files alone", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    // `src/app/api` goes, but the Studio's route is under `(val)/api` — a
    // different directory that happens to be spelled similarly, and the one
    // thing here that must survive.
    expect(exists(root, "src/app/(val)/api/val/[[...val]]/route.ts")).toBe(
      true,
    );
    expect(exists(root, "src/val/val.server.ts")).toBe(true);
  });

  it("drops every dependency that was only there for it", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    const { dependencies, devDependencies } = readPackageJson(root);
    for (const name of [
      "@valbuild/mcp",
      "@modelcontextprotocol/server",
      "mcp-handler",
      "zod",
      "sharp",
    ]) {
      expect(dependencies).not.toHaveProperty(name);
    }
    // And nothing else: an install that lost `next` is a worse outcome than
    // one that kept a dependency it did not need.
    expect(dependencies).toEqual({
      "@valbuild/core": "0.121.0",
      "@valbuild/next": "0.121.0",
      next: "16.3.3",
    });
    expect(devDependencies).toEqual({ "@valbuild/cli": "0.121.0" });
  });

  it("takes them off pnpm's list of packages allowed to build, too", () => {
    const root = writeTemplate();
    const packageJsonPath = path.join(root, "package.json");
    const withPnpm = {
      ...JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")),
      pnpm: { onlyBuiltDependencies: ["esbuild", "sharp"] },
    };
    fs.writeFileSync(packageJsonPath, JSON.stringify(withPnpm));

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    expect(JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).pnpm).toEqual({
      onlyBuiltDependencies: ["esbuild"],
    });
  });

  it("takes the README's MCP section out between its markers", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");
    expect(readme).not.toContain("Coding agents (MCP)");
    expect(readme).not.toContain("val:mcp:");
    expect(readme).toContain("Intro.");
    expect(readme).toContain("## Package manager");
  });

  it("leaves the README alone when the markers are not there", () => {
    // The markers are the contract. A README that documents a feature the
    // project does not have is a smaller problem than one cut in the wrong
    // place, so a template that has moved on gets left as it is.
    const root = writeTemplate();
    const unmarked = "# my-app\n\nNo markers here.\n";
    fs.writeFileSync(path.join(root, "README.md"), unmarked);

    applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES);

    expect(fs.readFileSync(path.join(root, "README.md"), "utf-8")).toBe(
      unmarked,
    );
  });

  it("survives a template that no longer has one of these files", () => {
    const root = writeTemplate();
    fs.rmSync(path.join(root, "src/val/mcp.images.ts"));
    fs.rmSync(path.join(root, "README.md"));

    expect(() =>
      applyFeatures(root, { mcp: false, imageUploads: false }, NEXT_FEATURES),
    ).not.toThrow();
    expect(readPackageJson(root).dependencies).not.toHaveProperty("sharp");
  });
});

describe("what it reports", () => {
  it("says nothing was removed when every feature is kept", () => {
    const root = writeTemplate();
    expect(
      applyFeatures(root, { mcp: true, imageUploads: true }, NEXT_FEATURES),
    ).toBe(false);
  });

  it("says something was removed when a feature was declined", () => {
    // Which is what decides whether generated files are rebuilt afterwards.
    expect(
      applyFeatures(
        writeTemplate(),
        { mcp: true, imageUploads: false },
        NEXT_FEATURES,
      ),
    ).toBe(true);
    expect(
      applyFeatures(
        writeTemplate(),
        { mcp: false, imageUploads: false },
        NEXT_FEATURES,
      ),
    ).toBe(true);
  });

  it("removes nothing a template does not list", () => {
    // A template without the feature has nothing to take out, whatever the
    // answer was.
    const root = writeTemplate();
    const before = readPackageJson(root);

    expect(applyFeatures(root, { mcp: false, imageUploads: false }, {})).toBe(
      false,
    );
    expect(readPackageJson(root)).toEqual(before);
    expect(exists(root, "src/app/api/mcp/route.ts")).toBe(true);
  });
});

describe("a TanStack Start template", () => {
  const TANSTACK_FEATURES: CatalogFeatures = {
    mcp: {
      paths: [
        "src/routes/api/mcp.ts",
        "src/routes/[.]well-known.oauth-protected-resource.ts",
        "src/val/mcp.server.ts",
        "src/val/mcp.images.server.ts",
      ],
      dependencies: ["@valbuild/mcp", "mcp-handler"],
      docs: ["README.md", "AGENTS.md"],
    },
    imageUploads: {
      file: "src/val/mcp.images.server.ts",
      dependencies: ["sharp"],
    },
  };

  function writeTanstackTemplate(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "val-create-test"));
    const write = (relativePath: string, contents: string) => {
      const absolute = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, contents);
    };
    write("src/routes/api/mcp.ts", "// the transport\n");
    write("src/routes/api/val.$.ts", "// the Studio's own API\n");
    write("src/routes/[.]well-known.oauth-protected-resource.ts", "// rfc\n");
    write("src/val/mcp.server.ts", "// the endpoint\n");
    write("src/val/mcp.images.server.ts", "// sharp\n");
    write(
      "package.json",
      `${JSON.stringify({
        dependencies: {
          "@valbuild/mcp": "1",
          "@valbuild/tanstack": "1",
          "mcp-handler": "1",
          sharp: "1",
        },
      })}\n`,
    );
    write(
      "AGENTS.md",
      [
        "# Working in this project",
        "",
        "Rules.",
        "",
        "<!-- val:mcp:start -->",
        "",
        "## Content tools (MCP)",
        "",
        "Served at /api/mcp.",
        "",
        "<!-- val:mcp:end -->",
        "",
      ].join("\n"),
    );
    return root;
  }

  it("keeps the Studio's API beside the MCP route it removes", () => {
    // Both live in `src/routes/api`, so the directory must survive.
    const root = writeTanstackTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, TANSTACK_FEATURES);

    expect(exists(root, "src/routes/api/mcp.ts")).toBe(false);
    expect(exists(root, "src/routes/api/val.$.ts")).toBe(true);
    expect(
      exists(root, "src/routes/[.]well-known.oauth-protected-resource.ts"),
    ).toBe(false);
    expect(exists(root, "src/val/mcp.server.ts")).toBe(false);
    expect(readPackageJson(root).dependencies).toEqual({
      "@valbuild/tanstack": "1",
    });
  });

  it("cuts a section at the end of a doc and leaves one newline", () => {
    const root = writeTanstackTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false }, TANSTACK_FEATURES);

    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toBe(
      "# Working in this project\n\nRules.\n",
    );
  });

  it("removes the image tools file with MCP even when only imageUploads names it", () => {
    // Left behind, it imports `sharp`, which goes with MCP's dependencies.
    const root = writeTanstackTemplate();
    const mcp = TANSTACK_FEATURES.mcp;
    if (!mcp) throw new Error("fixture");

    applyFeatures(
      root,
      { mcp: false, imageUploads: false },
      {
        ...TANSTACK_FEATURES,
        mcp: {
          ...mcp,
          paths: mcp.paths.filter((p) => p !== "src/val/mcp.images.server.ts"),
        },
      },
    );

    expect(exists(root, "src/val/mcp.images.server.ts")).toBe(false);
  });

  it("replaces its own image tools file when image uploads are declined", () => {
    const root = writeTanstackTemplate();

    applyFeatures(root, { mcp: true, imageUploads: false }, TANSTACK_FEATURES);

    expect(
      fs.readFileSync(path.join(root, "src/val/mcp.images.server.ts"), "utf-8"),
    ).toContain("export const valImageTools: ValToolImpl[] = []");
    expect(exists(root, "src/routes/api/mcp.ts")).toBe(true);
  });
});
