import { FILE_REF_PROP, ImageSource, VAL_EXTENSION } from "@valbuild/core";
import { createFilePatch } from "./primitives/FileField";

describe("Imagepatch", () => {
  test("Use filename of new image", () => {
    const defaultValue = {
      metadata: {
        width: 500,
        height: 875,
        sha256:
          "e0cc83d0f051d1e887bf9de64715512449443177b7f1565d369f8c04e307a954",
        mimeType: "image/png",
      },
      [FILE_REF_PROP]: "/public/gurba.png",
      [VAL_EXTENSION]: "file" as const,
    } as const;

    const path = ["0", "image"];
    const newPngImageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII";
    const newFileName = "image1.jpg";
    const newFilePath = `/public/image1_${defaultValue.metadata.sha256.slice(
      0,
      5,
    )}.png`;

    const imagePatch = [
      {
        value: {
          ...defaultValue,
          [FILE_REF_PROP]: newFilePath,
        },
        op: "replace",
        path,
      },
      {
        value: newPngImageData,
        op: "file",
        path,
        filePath: newFilePath,
      },
    ];
    const newPatch = createFilePatch(
      path,
      newPngImageData,
      newFileName,
      defaultValue.metadata,
    );
    expect(newPatch).toEqual(imagePatch);
  });

  test("No filextension should add ext", () => {
    const defaultValue = {
      metadata: {
        width: 500,
        height: 875,
        sha256:
          "e0cc83d0f051d1e887bf9de64715512449443177b7f1565d369f8c04e307a954",
        mimeType: "image/png",
      },
      [FILE_REF_PROP]: "/public/gurba.png",
      [VAL_EXTENSION]: "file",
    } satisfies ImageSource;

    const path = ["0", "image"];
    const newPngImageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII";
    const newFilePath = `/public/gurba_${defaultValue.metadata.sha256.slice(
      0,
      5,
    )}.png`;

    const imagePatch = [
      {
        value: {
          ...defaultValue,
          [FILE_REF_PROP]: newFilePath,
        },
        op: "replace",
        path,
      },
      {
        value: newPngImageData,
        op: "file",
        path,
        filePath: newFilePath,
      },
    ];
    const newPatch = createFilePatch(
      path,
      newPngImageData,
      "gurba",
      defaultValue.metadata,
    );
    expect(newPatch).toEqual(imagePatch);
  });

  test("No filename should use hash", () => {
    const defaultValue = {
      metadata: {
        width: 500,
        height: 875,
        sha256:
          "e0cc83d0f051d1e887bf9de64715512449443177b7f1565d369f8c04e307a954",
        mimeType: "image/png",
      },
      [FILE_REF_PROP]: "/public/gurba.png",
      [VAL_EXTENSION]: "file" as const,
    } satisfies ImageSource;

    const path = ["0", "image"];
    const newPngImageData =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII";
    const newFilePath = `/public/${defaultValue.metadata.sha256}.png`;

    const imagePatch = [
      {
        value: {
          ...defaultValue,
          [FILE_REF_PROP]: newFilePath,
        },
        op: "replace",
        path,
      },
      {
        value: newPngImageData,
        op: "file",
        path,
        filePath: newFilePath,
      },
    ];
    const newPatch = createFilePatch(
      path,
      newPngImageData,
      null,
      defaultValue.metadata,
    );
    expect(newPatch).toEqual(imagePatch);
  });

  test("Handle invalid images", () => {
    const defaultValue = {
      metadata: {
        width: 500,
        height: 875,
        sha256:
          "e0cc83d0f051d1e887bf9de64715512449443177b7f1565d369f8c04e307a954",
        mimeType: "image/png",
      },
      [FILE_REF_PROP]: "/public/gurba.png",
      [VAL_EXTENSION]: "file" as const,
    } satisfies ImageSource;

    const path = ["0", "image"];
    const newPngImageData = "🤘halla på deg! ha en fin dag a!🤘";
    const newFilePath = `/public/${defaultValue.metadata.sha256}.unknown`;

    const imagePatch = [
      {
        value: {
          ...defaultValue,
          [FILE_REF_PROP]: newFilePath,
        },
        op: "replace",
        path,
      },
      {
        value: newPngImageData,
        op: "file",
        path,
        filePath: newFilePath,
      },
    ];
    const newPatch = createFilePatch(
      path,
      newPngImageData,
      null,
      defaultValue.metadata,
    );
    expect(newPatch).toEqual(imagePatch);
  });
});
