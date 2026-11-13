/**
 * Which Val Build project this process works on: `VAL_PROJECT` when it is set,
 * and otherwise `project` in val.config.
 *
 * The environment wins because the same code runs against more than one
 * place. A site's `val.config.ts` names its val.build project, and the
 * deployment that points the site at a self-hosted engine, a staging content
 * host or a test fixture has no way to say otherwise without editing a file
 * that every other deployment shares. Before this, the config won in the
 * server and the environment won in `val validate`, so one setting meant two
 * different projects depending on which tool read it.
 *
 * An empty `VAL_PROJECT`, which is how CI hands over a secret that was never
 * set, counts as unset.
 */
export function valProjectOf(
  config: { readonly project?: string } | null | undefined,
  env: { readonly [name: string]: string | undefined } | undefined,
): string | undefined {
  const fromEnv = env?.["VAL_PROJECT"]?.trim();
  if (fromEnv) return fromEnv;
  return config?.project || undefined;
}

/**
 * {@link valProjectOf} for this process: `process.env` where there is one (a
 * browser's bundle may not replace it).
 */
export function valProject(
  config: { readonly project?: string } | null | undefined,
): string | undefined {
  return valProjectOf(
    config,
    typeof process === "undefined" ? undefined : process.env,
  );
}
