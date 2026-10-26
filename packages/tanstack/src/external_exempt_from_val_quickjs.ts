// Core (excluding initVal)
export { Schema, type SerializedSchema } from "@valbuild/core";
export type { SourceObject, SourcePrimitive, Source } from "@valbuild/core";
export type { ValModule, SerializedModule } from "@valbuild/core";
export type {
  FileSource,
  ImageSource,
  MediaSource,
  VideoSource,
} from "@valbuild/core";
export type { RichTextSource } from "@valbuild/core";
export {
  type Val,
  type SerializedVal,
  type ModuleFilePath,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "@valbuild/core";
export { modules, type ValModules } from "@valbuild/core";
export type { Json, JsonPrimitive } from "@valbuild/core";
export type { ValidationErrors, ValidationError } from "@valbuild/core";
export type { ValidationFix } from "@valbuild/core";
export * as expr from "@valbuild/core";
export { VAL_EXTENSION, type SourceArray } from "@valbuild/core";
export { derefPatch } from "@valbuild/core";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "@valbuild/core";

// React
export { ValRichText } from "@valbuild/react/internal";

// Stega
export {
  type ValEncodedString,
  type File,
  type Image,
  type Video,
  type RichText,
} from "@valbuild/react/stega";

// TanStack specific
export { ValProvider } from "./ValProvider";
export type { ValDraft } from "./ValDraft";
export type { ValAnalytics } from "./ValAnalytics";
export { ValImage, type ValImageProps } from "./ValImage";
export { ValVideo, type ValVideoProps } from "./ValVideo";
export { ValApp } from "./ValApp";
/** What `<ValApp demo={{ tours, audiences }}>` takes. See `ValDemoOptions`. */
export type {
  ValDemoOptions,
  ValDemoTour,
  ValDemoAudience,
  ValDemoTourStep,
  ValDemoTourMoveOn,
  ValDemoTourTarget,
  ValDemoTourPanel,
} from "@valbuild/shared/internal";
export { ValModulesClient, useRegisterValModules } from "./ValModulesClient";

import { Internal as InternalCore } from "@valbuild/core";
import type { selfCheck as selfCheckOf } from "@valbuild/shared/internal";
// Auto-tag JSX with Val paths:
import { autoTagJSX } from "@valbuild/react/stega";
import { VERSION } from "./version";

// NOTE! Side effects:
autoTagJSX();

// Convenience types
export type * as t from "./ValTypes";
export type { DecodeVal } from "@valbuild/react/stega";

/**
 * Annotated rather than inferred.
 *
 * The inferred type of the spread below reaches into @valbuild/core's internal
 * declaration files for names like `NonEmptyArray` and `createValPathOfItem`,
 * which the declaration emitter cannot write down portably: `preconstruct
 * build` fails with a wall of TS2883 "the inferred type of 'Internal' cannot be
 * named without a reference to ..." while `tsc --noEmit` stays happy, so it only
 * shows up in the build job. Naming the type in terms of `typeof InternalCore`
 * keeps everything the emitter needs reachable through the package entry point.
 */
type InternalWithTanStackVersion = Omit<typeof InternalCore, "VERSION"> & {
  VERSION: typeof InternalCore.VERSION & { tanstack: typeof VERSION };
  selfCheck: typeof selfCheckOf;
};

/**
 * This Val checking a site with its own rules, for the platform's upgrade
 * page: see `selfCheck` in `@valbuild/shared`. Reached here because this
 * package is the copy of Val that made the site's schemas, and it is in the
 * site's vendor layer already (`val.config.ts` imports `initVal` from it).
 *
 * Loaded when called, never at import time: `@valbuild/shared/internal` is
 * one module that holds zod, and a static import would put it in the bundle
 * of every page of every Val site (see `getClient` in `ValTanStackProvider`).
 */
const selfCheck: typeof selfCheckOf = async (valModules, options) =>
  (await import("@valbuild/shared/internal")).selfCheck(valModules, options);

export const Internal: InternalWithTanStackVersion = {
  ...InternalCore,
  VERSION: {
    ...InternalCore.VERSION,
    tanstack: VERSION,
  },
  selfCheck,
};
