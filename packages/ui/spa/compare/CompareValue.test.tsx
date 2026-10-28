/**
 * @jest-environment jsdom
 */
import "../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValFieldProvider } from "../components/ValFieldProvider";
import { CompareValue } from "./CompareValue";

jest.mock("../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

const { s, c } = initVal();

const gallery = c.define(
  "/content/images.val.ts",
  s.imagedir("/public/val/images", { accept: "image/jpeg" }),
  {
    "/public/val/images/sunset_a1b2c.jpg": {
      width: 800,
      height: 600,
      mimeType: "image/jpeg",
      alt: "A sunset",
    },
  },
);

const GALLERY = "/content/images.val.ts" as ModuleFilePath;
const ENTRY = Internal.createValPathOfItem(
  GALLERY,
  "/public/val/images/sunset_a1b2c.jpg",
)!;

function renderValue(path: SourcePath, side: "before" | "after") {
  const schema = Internal.getSchema(gallery)!;
  const source = Internal.getSource(gallery);
  const system = createStorySystem({
    schemas: { [GALLERY]: schema["executeSerialize"]() },
    sources: { [GALLERY]: source },
  });
  return render(
    <ValSystemProvider system={system}>
      <ValFieldProvider
        getDirectFileUploadSettings={async () => ({
          status: "success" as const,
          data: {
            nonce: null,
            baseUrl: "https://mock-upload.example.com",
            contentBaseUrl: null,
            contentAuthNonce: null,
          },
        })}
        config={undefined}
      >
        <CompareValue path={path} side={side} />
      </ValFieldProvider>
    </ValSystemProvider>,
  );
}

/**
 * A gallery entry's schema is the file's METADATA, so rendered as a field it
 * came out as a width, a height and a mime type -- and the compare dialog
 * showed a new image as everything but the image.
 */
test.each(["before", "after"] as const)(
  "a gallery entry renders as its picture on the %s side",
  async (side) => {
    const { container } = renderValue(ENTRY, side);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/val/images/sunset_a1b2c.jpg");
    expect(container.textContent).toContain("sunset_a1b2c.jpg");
    expect(container.textContent).toContain("800×600");
  },
);

test("a field inside a gallery entry is not mistaken for an entry", async () => {
  const { container } = renderValue(
    Internal.createValPathOfItem(ENTRY, "alt")!,
    "after",
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(container.querySelector("img")).toBeNull();
});
