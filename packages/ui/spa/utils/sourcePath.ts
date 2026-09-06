/**
 * Re-exported from `@valbuild/shared/internal`, where it now lives.
 *
 * It moved because `traverseSchemaSource` needs it and that moved to shared with
 * the search index. Sixteen files in the Studio import it from here, and none of
 * them care where the implementation sits — so the path stays and the function
 * has one home.
 */
export { sourcePathOfChild, concatModulePath } from "@valbuild/shared/internal";
