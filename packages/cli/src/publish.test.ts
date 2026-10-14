import { error } from "./logger";
import { publish } from "./publish";
import { runPublish } from "./publish/runPublish";
import { validateOnce } from "./validate";

jest.mock("./validate");
// chalk is ESM-only, which jest cannot load as CommonJS.
jest.mock("./logger", () => ({ error: jest.fn() }));
jest.mock("./publish/runPublish", () => ({
  ...jest.requireActual("./publish/runPublish"),
  runPublish: jest.fn(),
}));

const mockValidateOnce = jest.mocked(validateOnce);
const mockRunPublish = jest.mocked(runPublish);
const mockError = jest.mocked(error);

/**
 * `val publish` validates first: content that does not validate does not go
 * live. It is what lets the Studio trust a connected project's published
 * content without checking every file itself (docs/plans/studio-validate.md).
 */
describe("val publish validates before it publishes", () => {
  let log: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    process.exitCode = undefined;
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockRunPublish.mockResolvedValue({
      status: "verified",
      publishId: "p1",
      artifacts: 1,
      uploaded: 0,
      uploadedBytes: 0,
      previewUrl: null,
    });
  });

  afterEach(() => {
    log.mockRestore();
    errorLog.mockRestore();
    process.exitCode = undefined;
  });

  test("a validation error stops the publish before anything is built", async () => {
    mockValidateOnce.mockResolvedValue(2);
    await publish({ root: "/project", dryRun: true });
    expect(mockValidateOnce).toHaveBeenCalledWith({
      projectRoot: "/project",
      fix: false,
    });
    expect(mockRunPublish).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(
      "Not published: 2 validation errors.",
    );
    expect(process.exitCode).toBe(1);
  });

  test("it never fixes: CI must not rewrite what it was asked to publish", async () => {
    mockValidateOnce.mockResolvedValue(0);
    await publish({ root: "/project" });
    expect(mockValidateOnce).toHaveBeenCalledWith(
      expect.objectContaining({ fix: false }),
    );
  });

  test("content that validates is published", async () => {
    mockValidateOnce.mockResolvedValue(0);
    await publish({ root: "/project", dryRun: true });
    expect(mockRunPublish).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  test("--skip-validation publishes without validating", async () => {
    await publish({ root: "/project", dryRun: true, skipValidation: true });
    expect(mockValidateOnce).not.toHaveBeenCalled();
    expect(mockRunPublish).toHaveBeenCalledTimes(1);
  });
});
