import { SerializedImageSchema } from "../schema/image";
import { getValidationBasis } from "./validationBasis";

/**
 * The validation hash is baked into every remote ref that has already been
 * published. Anything that changes it makes Val re-validate — or reject —
 * content that was fine a moment ago, so what belongs in the basis is a
 * decision, not an accident of which fields the schema happens to carry.
 */
describe("getValidationBasis", () => {
  const metadata = { width: 100, height: 50, mimeType: "image/webp" };
  const basisOf = (schema: SerializedImageSchema) =>
    getValidationBasis("1.0.0", schema, "webp", metadata, "abc123");

  const plain: SerializedImageSchema = { type: "image", opt: false };

  /**
   * `encode` says how the bytes were PRODUCED in the browser, not whether the
   * bytes that arrived are valid. If it reached the hash, adding the option to
   * a schema — or nudging a quality setting — would invalidate every remote
   * file in the project.
   */
  test("ignores the encode option entirely", () => {
    expect(
      basisOf({ type: "image", opt: false, options: { encode: false } }),
    ).toBe(basisOf(plain));
    expect(
      basisOf({
        type: "image",
        opt: false,
        options: { encode: { type: "webp", quality: 0.5 } },
      }),
    ).toBe(basisOf(plain));
    expect(
      basisOf({
        type: "image",
        opt: false,
        options: { encode: { type: "webp", quality: 0.9 } },
      }),
    ).toBe(basisOf(plain));
  });

  test("a schema with no options at all hashes the same as one with only encode", () => {
    expect(
      basisOf({
        type: "image",
        opt: false,
        options: { encode: { type: "webp" } },
      }),
    ).toBe(basisOf(plain));
  });

  /** The options that DO describe validity still have to move the hash. */
  test("still tracks accept", () => {
    expect(
      basisOf({ type: "image", opt: false, options: { accept: "image/png" } }),
    ).not.toBe(basisOf(plain));
  });

  test("still tracks the metadata and the file", () => {
    expect(
      getValidationBasis("1.0.0", plain, "webp", metadata, "different"),
    ).not.toBe(basisOf(plain));
    expect(
      getValidationBasis(
        "1.0.0",
        plain,
        "webp",
        { ...metadata, width: 101 },
        "abc123",
      ),
    ).not.toBe(basisOf(plain));
    expect(
      getValidationBasis("1.0.0", plain, "png", metadata, "abc123"),
    ).not.toBe(basisOf(plain));
  });

  /**
   * Pinned as a literal: a refactor that reorders the JSON, or drops a field,
   * silently re-validates every published remote file. This value is what
   * shipped, so a diff here is the thing to argue about, not to accept.
   */
  test("is unchanged for a schema that predates encode", () => {
    expect(
      basisOf({ type: "image", opt: false, options: { accept: "image/*" } }),
    ).toBe(
      '1.0.0{"type":"image","opt":false,"options":{"accept":"image/*"}}webp10050image/webpabc123',
    );
  });
});
