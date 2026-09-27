/**
 * Runs `transformRemoveDevtools` over each case in removeDevtools.test.ts and
 * reports the output, and whether that output still parses.
 *
 * A separate process for the reason splitEnvMarkersProbe.ts gives: the parser
 * is `@rolldown/browser`'s, which is ESM-only, and jest runs CommonJS here. The
 * cases and the assertions stay in the test -- this only reports.
 */
import { parse } from "../ast";
import { transformRemoveDevtools } from "../removeDevtools";

async function main() {
  const cases: Record<string, string> = JSON.parse(process.argv[2]!);
  const out: Record<string, { code: string | null; parses: boolean }> = {};
  for (const [name, code] of Object.entries(cases)) {
    const result = await transformRemoveDevtools(`${name}.tsx`, code);
    let parses = true;
    try {
      await parse(`${name}.tsx`, result?.code ?? code);
    } catch {
      parses = false;
    }
    out[name] = { code: result?.code ?? null, parses };
  }
  console.log(JSON.stringify(out));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
