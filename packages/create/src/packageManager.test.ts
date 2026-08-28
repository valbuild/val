import {
  detectPackageManager,
  foreignLockFiles,
  parsePackageManagerArgs,
  resolvePackageManager,
} from "./packageManager";

describe("detectPackageManager", () => {
  test("reads the package manager out of npm_config_user_agent", () => {
    expect(
      detectPackageManager(
        "npm/10.9.0 node/v22.11.0 linux x64 workspaces/false",
      ),
    ).toBe("npm");
    expect(
      detectPackageManager("pnpm/10.4.1 npm/? node/v22.11.0 linux x64"),
    ).toBe("pnpm");
    expect(
      detectPackageManager("yarn/1.22.22 npm/? node/v22.11.0 linux x64"),
    ).toBe("yarn");
    expect(
      detectPackageManager("bun/1.2.2 npm/? node/v22.11.0 linux x64"),
    ).toBe("bun");
  });

  test("is null when there is nothing usable to read", () => {
    expect(detectPackageManager(undefined)).toBeNull();
    expect(detectPackageManager("")).toBeNull();
    expect(detectPackageManager("deno/2.1.4 node/v22.11.0")).toBeNull();
  });
});

describe("parsePackageManagerArgs", () => {
  test("recognizes the --use-<name> flags", () => {
    expect(parsePackageManagerArgs(["--use-pnpm"])).toEqual({
      packageManager: "pnpm",
      invalidFlag: null,
      rest: [],
    });
    expect(parsePackageManagerArgs(["--use-bun"]).packageManager).toBe("bun");
  });

  test("recognizes --package-manager and --pm, joined or separate", () => {
    expect(parsePackageManagerArgs(["--package-manager", "pnpm"])).toEqual({
      packageManager: "pnpm",
      invalidFlag: null,
      rest: [],
    });
    expect(
      parsePackageManagerArgs(["--package-manager=yarn"]).packageManager,
    ).toBe("yarn");
    expect(parsePackageManagerArgs(["--pm", "npm"]).packageManager).toBe("npm");
    expect(parsePackageManagerArgs(["--pm=pnpm"]).packageManager).toBe("pnpm");
  });

  test("leaves every other argument alone", () => {
    expect(
      parsePackageManagerArgs(["my-app", "--use-pnpm", "--root", "/tmp"]),
    ).toEqual({
      packageManager: "pnpm",
      invalidFlag: null,
      rest: ["my-app", "--root", "/tmp"],
    });
  });

  test("does not mistake the value of --package-manager for a project name", () => {
    expect(
      parsePackageManagerArgs(["--package-manager", "pnpm", "my-app"]).rest,
    ).toEqual(["my-app"]);
  });

  test("the last flag wins", () => {
    expect(
      parsePackageManagerArgs(["--package-manager", "pnpm", "--use-npm"])
        .packageManager,
    ).toBe("npm");
  });

  test("reports an unknown package manager verbatim, without picking one", () => {
    expect(parsePackageManagerArgs(["--use-deno"])).toEqual({
      packageManager: null,
      invalidFlag: "--use-deno",
      rest: [],
    });
    expect(
      parsePackageManagerArgs(["--package-manager", "deno"]).invalidFlag,
    ).toBe("--package-manager deno");
    expect(parsePackageManagerArgs(["--package-manager"]).invalidFlag).toBe(
      "--package-manager",
    );
  });
});

describe("resolvePackageManager", () => {
  test("a flag beats the package manager that ran the command", () => {
    const resolved = resolvePackageManager(
      ["--use-pnpm"],
      "npm/10.9.0 node/v22",
    );
    expect(resolved.packageManager).toBe("pnpm");
    expect(resolved.source).toBe("flag");
  });

  test("without a flag, the package manager that ran the command is used", () => {
    const resolved = resolvePackageManager([], "pnpm/10.4.1 node/v22");
    expect(resolved.packageManager).toBe("pnpm");
    expect(resolved.source).toBe("user-agent");
  });

  test("falls back to npm when there is nothing to go on", () => {
    const resolved = resolvePackageManager([], undefined);
    expect(resolved.packageManager).toBe("npm");
    expect(resolved.source).toBe("default");
  });

  test("an unknown flag does not silently fall back", () => {
    const resolved = resolvePackageManager(
      ["--use-deno"],
      "pnpm/10.4.1 node/v22",
    );
    expect(resolved.invalidFlag).toBe("--use-deno");
  });
});

describe("foreignLockFiles", () => {
  test("keeps the chosen package manager's own lock files", () => {
    expect(foreignLockFiles("npm")).toEqual([
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ]);
    expect(foreignLockFiles("pnpm")).toEqual([
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ]);
    expect(foreignLockFiles("pnpm")).not.toContain("pnpm-lock.yaml");
  });
});
