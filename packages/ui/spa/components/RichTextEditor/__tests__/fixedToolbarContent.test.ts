import { buildSchema } from "../schema";
import { serializedRichTextOptionsToFeatures } from "../convertOptions";
import { hasFixedToolbarContent } from "../plugins/formattingToolbarShared";
import { DEFAULT_FEATURES, type ResolvedEditorFeatures } from "../types";
import type { SerializedRichTextOptions } from "@valbuild/core";

/**
 * The empty toolbar, and why it was mounted at all.
 *
 * `s.richtext()` with no argument does NOT reach the UI as `undefined`: the
 * schema stores `options ?? {}` and serialization always emits an object with
 * every key `undefined`. So `serializedRichTextOptionsToFeatures`'s
 * `if (!options) return {}` never fires, every feature resolves to `false`,
 * and `fixedToolbar` was nevertheless hardcoded `true` — which mounted a bar
 * with no buttons in it: a ~10px strip whose border doubled the editor's own,
 * over 56px of `pt-14` reserved for content that never arrived.
 */

/** What the editor actually receives for a given `s.richtext(options)`. */
function resolve(options: SerializedRichTextOptions): ResolvedEditorFeatures {
  return {
    ...DEFAULT_FEATURES,
    ...serializedRichTextOptionsToFeatures(options),
  };
}

function shows(options: SerializedRichTextOptions): boolean {
  const features = resolve(options);
  const schema = buildSchema({ features });
  return (
    features.fixedToolbar &&
    hasFixedToolbarContent({ schema, features, canInsertImage: true })
  );
}

describe("the fixed toolbar is mounted only when it has content", () => {
  test("`s.richtext()` serializes to an object, not undefined", () => {
    // The whole bug in one assertion: the guard that was supposed to catch
    // "no options" is looking for a falsy value that never arrives.
    const features = serializedRichTextOptionsToFeatures({});
    expect(features).not.toEqual({});
    expect(features.bold).toBe(false);
  });

  test("no options: no toolbar", () => {
    expect(shows({})).toBe(false);
  });

  test.each<[string, SerializedRichTextOptions]>([
    ["bold", { style: { bold: true } }],
    ["italic", { style: { italic: true } }],
    ["lineThrough", { style: { lineThrough: true } }],
    ["a bullet list", { block: { ul: true } }],
    ["an ordered list", { block: { ol: true } }],
    ["h1", { block: { h1: true } }],
    ["h2", { block: { h2: true } }],
    ["h3", { block: { h3: true } }],
    ["links", { inline: { a: true } }],
    ["images", { inline: { img: true } }],
  ])("%s: toolbar", (_name, options) => {
    expect(shows(options)).toBe(true);
  });

  test.each<[string, SerializedRichTextOptions]>([
    ["h4", { block: { h4: true } }],
    ["h5", { block: { h5: true } }],
    ["h6", { block: { h6: true } }],
  ])("%s alone: no toolbar, because it has no control", (_name, options) => {
    // `getBlockTypeItems` only offers levels 1-3, so h4-h6 are real features
    // with nothing in the bar to represent them. This is exactly why the
    // condition is asked through the toolbar's own builders rather than
    // re-derived from the feature flags.
    expect(shows(options)).toBe(false);
  });

  test("an image field with nowhere to get an image from: no toolbar", () => {
    const features = resolve({ inline: { img: true } });
    const schema = buildSchema({ features });
    expect(
      hasFixedToolbarContent({ schema, features, canInsertImage: false }),
    ).toBe(false);
  });

  test("custom styles alone are enough", () => {
    const features = resolve({});
    const styleConfig = { lead: { label: "Lead", css: { fontSize: "20px" } } };
    const schema = buildSchema({ features, styleConfig });
    expect(
      hasFixedToolbarContent({
        schema,
        features,
        styleConfig,
        canInsertImage: false,
      }),
    ).toBe(true);
  });
});
