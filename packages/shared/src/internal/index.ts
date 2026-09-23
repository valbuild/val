export * from "./richtext/conversion";
export * from "./server/types";
// One `/sources/~` read per request, shared by every `fetchVal` in it. Lives
// here rather than in @valbuild/next and @valbuild/tanstack separately
// because the rule it encodes is a leak rule -- the memoised response carries
// the caller's OWN unpublished patches -- and the two framework packages are
// near-copies that would drift on exactly the comment that says so.
export * from "./server/requestScopedMemo";
export * from "./ValClient";
export * from "./ValUrls";
export * from "./ApiRoutes";
export * from "./schema/compatibility";
export * from "./newestCommitSha";
export * from "./zod/Patch";
export * from "./sessionStorage";
export * from "./SharedValConfig";
export * from "./zod/ValCommit";
export * from "./zod/History";
export * from "./zod/ValDeployment";
export * from "./getSitemapTree";
export * from "./parseRoutePattern";
export * from "./getNextAppRouterSourceFolder";
export * from "./routeValidation";
export * from "./resolveSchemaSourceFixes";
export * from "./localeAt";
export * from "./getErrorMessageFromUnknownJson";
export * from "./zod/SerializedSchema";
export * from "./valCanvasProtocol";
// Schema-shaped helpers that both realms need: the Studio's chat tools run in
// the browser, and the MCP tool registry in @valbuild/server runs server-side,
// but the patches they build and the errors they filter are the same logic.
// Kept here rather than duplicated, since @valbuild/server cannot import from
// @valbuild/ui's spa/**.
export * from "./emptyOf";
export * from "./aiTools/toolNames";
export * from "./aiTools/aiImageToolPatches";
export * from "./aiTools/aiSourceToolPatches";
export * from "./validation/partitionValidationErrors";
export * from "./validation/blockingValidationErrors";
// What `s.image({ encode })` means, with none of the pixels: the Studio runs
// the conversion on a canvas and the MCP image tool runs it on sharp, and the
// two must agree on which images get converted and how far they are scaled.
export * from "./media/encodeImageDecisions";
// Full-text search over content. Shared because two realms search the same
// project: the Studio's worker-backed index, and the MCP `search_content` tool,
// which builds one per call. What counts as a document must not differ.
export * from "./search/searchIndex";
export * from "./search/traverseSchemaSource";
export * from "./search/getFilenameFromRef";
export * from "./search/sourcePath";
// The Studio's chrome, generated from `s.settings()`'s `theme.accent`. Shared
// rather than in @valbuild/ui because the contrast guarantee is data, not code:
// `BRAND_CONTRAST_PAIRS` is run both over generated ramps here and over the
// ramp resolved out of the real index.css by the UI's own contrast test.
export * from "./theme/accentRamp";
/*
 * The content service's publish API, and the parsers for its answers.
 *
 * Shared because two publishers speak it and must agree about what content
 * said: `val publish`, from a checkout with a project token, and the STUDIO,
 * which builds a managed project in its own tab and publishes through the
 * deployment. One copy of the shapes and one set of parsers, so a wire change
 * cannot be noticed by one of them and missed by the other -- which is how
 * `home` and `@valbuild/server` have already diverged three times.
 */
export * from "./publish/contentApi";
export * from "./publish/protocol";
