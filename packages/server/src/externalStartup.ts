import { hasMediaSchema } from "@valbuild/core";
import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { ExternalRecords } from "./externalRecords";

/**
 * The checks that decide whether a project's external records are wired up at
 * all — run once, at startup, rather than discovered when an editor opens a
 * record and gets an empty list.
 *
 * There are two halves to being wired up, and each fails in its own quiet way:
 *
 * - **A module says `.external("posts")` and nothing bound it.** The record
 *   reads as empty. Empty is a legitimate state for a store, so nothing further
 *   down can tell the difference — which is why it has to be caught here.
 * - **Something bound "posts" and no module asks for it.** Usually a rename that
 *   moved one half: the adapter is dead code, and the module it used to serve is
 *   now the case above.
 *
 * Both are reported as module errors, so `/sources/~` fails with "Val is not
 * correctly setup" naming the module, exactly as a nested `.jsonValues()` does.
 */

/**
 * Same shape as `ModulesError` in `ValOps`, without the import cycle.
 *
 * Warnings carry it too — what separates the two is which array they come back
 * in and what the caller does with them, not their shape.
 */
export type ExternalSetupError = { path: ModuleFilePath; message: string };

/**
 * External records nested below a module's root, which are not supported.
 *
 * The twin of `findNestedJsonValuesRecords`, and unsupported for a sharper
 * reason: a binding names a MODULE, so there is nowhere for a second adapter
 * inside the same module to be registered. A nested one would read as an empty
 * record forever.
 */
export function findNestedExternalRecords(
  schema: SerializedSchema,
  path: string[] = [],
): string[][] {
  const found: string[][] = [];
  const rec = (current: SerializedSchema, currentPath: string[]) => {
    if (
      current.type === "record" &&
      current.external !== undefined &&
      currentPath.length > 0
    ) {
      found.push(currentPath);
      // Do not descend: everything below lives in the store.
      return;
    }
    switch (current.type) {
      case "object":
        for (const key of Object.keys(current.items)) {
          rec(current.items[key], currentPath.concat(key));
        }
        return;
      case "record":
        rec(current.item, currentPath.concat("*"));
        return;
      case "array":
        rec(current.item, currentPath.concat("*"));
        return;
      case "union":
        for (let i = 0; i < current.items.length; i++) {
          rec(current.items[i], currentPath.concat(`union[${i}]`));
        }
        return;
      default:
        return;
    }
  };
  rec(schema, path);
  return found;
}

/** The label a module's ROOT record declares, if it declares one. */
export function rootExternalLabel(
  schema: SerializedSchema,
): string | undefined {
  return schema.type === "record" ? schema.external : undefined;
}

/**
 * Check a project's schemas against its registry.
 *
 * `records` being undefined means the project registered nothing at all, which
 * is only an error if some module expects an adapter — a project with no
 * external records must not be told to configure something it does not use.
 *
 * Errors block the module, as a nested `.jsonValues()` does. Warnings are
 * logged and nothing else: they describe a setup that works today and will fail
 * on a big enough file, which is not something to refuse to boot over.
 */
export function checkExternalSetup(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  records: ExternalRecords | undefined,
): { errors: ExternalSetupError[]; warnings: ExternalSetupError[] } {
  const errors: ExternalSetupError[] = [];
  const warnings: ExternalSetupError[] = [];
  const boundLabels = new Set<string>();

  for (const moduleFilePathS of Object.keys(schemas)) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (schema === undefined) {
      continue;
    }
    for (const nestedPath of findNestedExternalRecords(schema)) {
      errors.push({
        path: moduleFilePath,
        message: `Nested .external() records are not supported: '${nestedPath.join(
          ".",
        )}' in ${moduleFilePath}. Use .external() only on a module's root record/router.`,
      });
    }
    const label = rootExternalLabel(schema);
    if (label === undefined) {
      continue;
    }
    const binding = records?.bindings[label];
    if (binding === undefined) {
      errors.push({
        path: moduleFilePath,
        message: `${moduleFilePath} is .external("${label}"), but no adapter is registered for '${label}'. Add it to the modules({ ... }) call in your external records file, and pass that file's default export as the 'external' option.`,
      });
      continue;
    }
    boundLabels.add(label);
    // Media is required by the item SCHEMA, not by the adapter type — a gallery
    // stores its files under keys the type system never sees, and an inline
    // richtext image lives in a constructor argument. So it is checked here,
    // where both halves are in hand.
    //
    // Only presence is checked: the `files` union already guarantees that
    // whichever arm is chosen carries both a write path and a read path, so
    // "stores bytes nowhere" and "serves bytes from nowhere" are states this
    // type cannot express.
    if (hasMediaSchema(schema)) {
      const files = binding.adapter.files;
      if (files === undefined) {
        errors.push({
          path: moduleFilePath,
          message: `${moduleFilePath} stores images or files, but the adapter for '${label}' has no 'files'. An external record whose items hold media must say where the bytes go: add files: { type: "bytes", put, get } to route them through this server, or files: { type: "presigned", signUpload, url } to upload them directly to your store.`,
        });
      } else if (files.type === "bytes") {
        const platform = bodyLimitedPlatform();
        if (platform !== undefined) {
          // A warning, not an error. An adapter whose record only ever holds
          // small files is not wrong, and Val cannot know that it does not.
          // What it can do is say so at boot, naming the platform and the
          // limit, rather than let an editor find out from a failed upload.
          warnings.push({
            path: moduleFilePath,
            message: `${moduleFilePath} stores images or files and the adapter for '${label}' is files.type "bytes", which routes every byte through this server. This looks like a ${platform.name} deployment, where a request body is capped at ${platform.limit} — a larger upload will fail, and so will reading one back. Use files: { type: "presigned", signUpload, url } to upload directly to your store.`,
          });
        }
      }
    }
    if (binding.moduleFilePath !== moduleFilePath) {
      // The label is a type-level check at the `modules({ ... })` call, so this
      // is for the caller TypeScript did not see: a JavaScript project, or one
      // where the two files were never typechecked together.
      errors.push({
        path: moduleFilePath,
        message: `${moduleFilePath} is .external("${label}"), but '${label}' is bound to ${binding.moduleFilePath}.`,
      });
    }
  }

  for (const [label, binding] of Object.entries(records?.bindings ?? {})) {
    if (boundLabels.has(label)) {
      continue;
    }
    // Usually a rename that moved only one half. Reported against the module the
    // binding names, which is where the developer will look.
    errors.push({
      path: binding.moduleFilePath,
      message: `An external adapter is registered as '${label}' for ${binding.moduleFilePath}, but no module declares .external("${label}"). Either add it to the schema, or remove the binding.`,
    });
  }

  return { errors, warnings };
}

/**
 * The deployment platform's request body cap, if this looks like one that has
 * one.
 *
 * Environment variables rather than configuration, because the developer should
 * not have to tell Val where it is running — and because the answer is only
 * used to decide whether to say something. A false negative costs a warning
 * nobody got; a false positive costs a warning that names a platform this is
 * not, which is why the check is a set of vendor-set variables rather than a
 * guess.
 *
 * The response side has the same ceiling on all of these, which is why the
 * warning mentions reading a file back as well as writing one.
 */
function bodyLimitedPlatform(): { name: string; limit: string } | undefined {
  const env = typeof process === "undefined" ? undefined : process.env;
  if (env === undefined) {
    return undefined;
  }
  if (env.VERCEL) {
    return { name: "Vercel", limit: "4.5 MB" };
  }
  if (env.NETLIFY) {
    return { name: "Netlify", limit: "6 MB" };
  }
  if (env.CF_PAGES) {
    return { name: "Cloudflare Pages", limit: "100 MB" };
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME) {
    return { name: "AWS Lambda", limit: "6 MB" };
  }
  return undefined;
}
