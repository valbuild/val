import { quickPreviewOnServer } from "./quickPreviewOnServer";
import { ProposalsApiError } from "./proposalsClient";

const INPUTS = "a".repeat(64);

function proposal(inputs: string | null) {
  return {
    staged: { files: ["src/Hero.tsx"], inputs, buildRequired: true },
  };
}

const FILES = {
  "app.js": { body: "the app", contentType: "text/javascript" },
};

describe("quickPreviewOnServer: Val Build makes the quick preview", () => {
  test("the staged files are built there, and their browser half is handed back", async () => {
    const steps: string[] = [];
    const quickPreview = jest
      .fn()
      .mockResolvedValue({ inputs: INPUTS, files: FILES });
    const outcome = await quickPreviewOnServer(
      "0123456789abcdef0123",
      { get: async () => proposal(INPUTS), quickPreview },
      (label) => steps.push(label),
    );
    expect(outcome).toEqual({ status: "built", files: FILES, inputs: INPUTS });
    expect(quickPreview).toHaveBeenCalledWith("0123456789abcdef0123", INPUTS);
    expect(steps).toEqual(["Reading the proposal", "Building on Val Build"]);
  });

  test("a project Val Build does not build is off, and the page makes it", async () => {
    const outcome = await quickPreviewOnServer(
      "0123456789abcdef0123",
      {
        get: async () => proposal(INPUTS),
        quickPreview: async () => {
          throw new ProposalsApiError(409, "off", {
            message: "off",
            details: { code: "server-builds-off" },
          });
        },
      },
      () => {},
    );
    expect(outcome).toEqual({ status: "off" });
  });

  test("content from before quick previews were made there is off too", async () => {
    const outcome = await quickPreviewOnServer(
      "0123456789abcdef0123",
      {
        get: async () => proposal(INPUTS),
        quickPreview: async () => {
          throw new ProposalsApiError(
            404,
            "The proposals API answered 404.",
            undefined,
          );
        },
      },
      () => {},
    );
    expect(outcome).toEqual({ status: "off" });
  });

  test("code that does not build is the preview's failure, in the builder's words", async () => {
    const outcome = await quickPreviewOnServer(
      "0123456789abcdef0123",
      {
        get: async () => proposal(INPUTS),
        quickPreview: async () => {
          throw new ProposalsApiError(
            422,
            "The proposal's code does not build: Unexpected token (16:21)",
            {
              message:
                "The proposal's code does not build: Unexpected token (16:21)",
            },
          );
        },
      },
      () => {},
    );
    expect(outcome).toEqual({
      status: "failed",
      message: "The proposal's code does not build: Unexpected token (16:21)",
    });
  });

  test("nothing staged is nothing to preview, and Val Build is not asked", async () => {
    const quickPreview = jest.fn();
    const outcome = await quickPreviewOnServer(
      "0123456789abcdef0123",
      { get: async () => proposal(null), quickPreview },
      () => {},
    );
    expect(outcome.status).toBe("failed");
    expect(quickPreview).not.toHaveBeenCalled();
  });
});
