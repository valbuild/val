export const VAL_CLIENT = (configImportPath: string) => `import "client-only";
import { initValClient } from "@valbuild/next/client";
import { config } from "${configImportPath}";

const { useValStega: useVal } = initValClient(config);

export { useVal };
`;

export const VAL_RSC = (configImportPath: string) => `import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "${configImportPath}";
import { cookies, draftMode, headers } from "next/headers";

const { fetchValStega: fetchVal } = initValRsc(config, {
  draftMode,
  headers,
  cookies,
});

export { fetchVal };
`;

export const VAL_SERVER = (configImportPath: string) => `import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "${configImportPath}";
import { draftMode } from "next/headers";

const { valNextAppRouter } = initValServer(
  { ...config },
  {
    draftMode,
  }
);

export { valNextAppRouter };
`;

// TODO: use Val config
type ValConfig = {
  valCloud?: string;
  gitCommit?: string;
  gitBranch?: string;
  valConfigPath?: string;
};
export const VAL_CONFIG = (
  isTypeScript: boolean,
  options: ValConfig
) => `import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal(${JSON.stringify(options, null, 2)});

${isTypeScript ? 'export type { t } from "@valbuild/next";' : ""};
export { s, c, val, config };
`;

export const VAL_API_ROUTER = (
  valServerPath: string
) => `import { valNextAppRouter } from "${valServerPath}";

export const GET = valNextAppRouter;
export const POST = valNextAppRouter;
export const PATCH = valNextAppRouter;
export const DELETE = valNextAppRouter;
export const PUT = valNextAppRouter;
export const HEAD = valNextAppRouter;
`;

export const VAL_APP_PAGE = (
  configImportPath: string
) => `import { ValApp } from "@valbuild/next";
import { config } from "${configImportPath}";

export default function Val() {
  return <ValApp config={config} />;
}
`;

export const BASIC_EXAMPLE = (
  moduleId: string,
  configImportPath: string,
  isJavaScript: boolean
) => `${isJavaScript ? "// @ts-check\n" : ""}/**
 * Val example file - generated by @valbuild/init
 **/

import {
  s /* s = schema */,
  c /* c = content */,${isJavaScript ? "" : "\n  type t /* t = type */,"}
} from "${configImportPath}";

/**
 * This is the schema for the content. It defines the structure of the content and the types of each field.
 *
 * @docs https://val.build/docs/api-reference
 */
export const testSchema = s.object({
  /**
   * Basic text field
   */
  text: s.string(),

  /**
   * Optional fields are marked with \`.optional()\`
   */
  optionals: s.string().optional(),

  arrays: s.array(s.string()),
  /**
   * Records are objects where entries can be added. Useful for array-like structures where you would use a key to uniquely identify each entry.
   */
  records: s.record(s.string()),

  /**
   * Rich text can be used for multiline text, but also for more complex text editing capabilities like links, images, lists, etc.
   *
   * @docs https://val.build/docs/api-reference/schema-types/richtext
   *
   * @see ValRichText will render rich text
   */
  richText: s.richtext({
    // All features enabled:
    bold: true,
    italic: true,
    lineThrough: true,
    headings: ["h1", "h2", "h3", "h4", "h5", "h6"],
    a: true,
    img: true,
    ul: true,
    ol: true,
  }),

  /**
   * Images in Val are stored as files in the public folder.
   *
   * @docs https://val.build/docs/api-reference/schema-types/image
   *
   * When defining content use the following syntax:
   * @example c.file('/public/myimage.png') // path to the image file, use the VS Code plugin or the \`@valbuild/cli validate --fix\` command to add metadata
   *
   * @see ValImage component to see how to render this in your app
   */
  image: s.image().optional(),

  /**
   * String enums: presents as a dropdown in the UI
   */
  stringEnum: s.union(s.literal("lit-0"), s.literal("lit-1")),

  /**
   * Raw strings disables the stega (steganography) feature that automatically tags content when using the overlay.
   * It is useful for slugs and other data that might be processed in code (parsed or matching for equality...)
   */
  slug: s.string().raw(),

  /**
   * Object unions: presents as a dropdown in the UI and the different fields
   *
   * @docs https://val.build/docs/api-reference/schema-types/union
   */
  objectUnions: s.union(
    "type",
    s.object({
      type: s.literal("page-type-1"),
      value: s.number(),
    }),
    s.object({
      type: s.literal("page-type-2"),
      text: s.string(),
    })
  ),
});
${
  isJavaScript
    ? ""
    : `
/**
 * t.inferSchema returns the type of the content.
 * This pattern is useful to type props of components that use this content (partially or whole)
 */
export type TestContent = t.inferSchema<typeof testSchema>;
`
}

/**
 * This is the content definition. Add your content below.
 *
 * NOTE: the first argument, module id, must match the path of the file.
 */
export default c.define("${moduleId}", testSchema, {
  text: "Basic text content",
  optionals: null,
  arrays: ["A string"],
  records: {
    "unique-key-1": "A string",
  },
  richText: c.richtext\`# Title 1

\${c.rt.link("Val docs", { href: "https://val.build/docs" })}

- List item 1
- List item 2
\`,
  image: null,
  slug: "test",
  objectUnions: {
    type: "page-type-2",
    text: "String value",
  },
  stringEnum: "lit-1",
});
`;
