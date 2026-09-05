import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyFeatures } from "./features";

/**
 * Taking the declined features back out of a downloaded template.
 *
 * Written against a directory shaped like the real template rather than a
 * mock, because every failure this can have is about a path or a key being
 * slightly different from the one that is actually there — and a mock built
 * from the same assumptions as the code would agree with it either way.
 */

/** The parts of `template-nextjs-starter` these functions touch. */
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

    applyFeatures(root, { mcp: true, imageUploads: true });

    expect(readPackageJson(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root, "src/val/mcp.images.ts"), "utf-8")) //
      .toBe("// sharp lives here\n");
    expect(exists(root, "src/app/api/mcp/route.ts")).toBe(true);
  });
});

describe("image uploads declined", () => {
  it("replaces the image tools with an empty list and drops sharp", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: true, imageUploads: false });

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

    applyFeatures(root, { mcp: true, imageUploads: false });

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

    applyFeatures(root, { mcp: false, imageUploads: false });

    expect(exists(root, "src/val/mcp.ts")).toBe(false);
    expect(exists(root, "src/val/mcp.images.ts")).toBe(false);
    expect(exists(root, "src/app/api")).toBe(false);
    expect(exists(root, "src/app/.well-known")).toBe(false);
  });

  it("leaves the Studio's own route and files alone", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false });

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

    applyFeatures(root, { mcp: false, imageUploads: false });

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

  it("takes the README's MCP section out between its markers", () => {
    const root = writeTemplate();

    applyFeatures(root, { mcp: false, imageUploads: false });

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

    applyFeatures(root, { mcp: false, imageUploads: false });

    expect(fs.readFileSync(path.join(root, "README.md"), "utf-8")).toBe(
      unmarked,
    );
  });

  it("survives a template that no longer has one of these files", () => {
    const root = writeTemplate();
    fs.rmSync(path.join(root, "src/val/mcp.images.ts"));
    fs.rmSync(path.join(root, "README.md"));

    expect(() =>
      applyFeatures(root, { mcp: false, imageUploads: false }),
    ).not.toThrow();
    expect(readPackageJson(root).dependencies).not.toHaveProperty("sharp");
  });
});
