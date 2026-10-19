/**
 * Runs `transformServerFns` over each case in serverFns.test.ts for both
 * targets and reports the output, whether it still parses, or the error.
 *
 * A separate process for the reason removeDevtoolsProbe.ts gives: the parser
 * is `@rolldown/browser`'s, which is ESM-only, and jest runs CommonJS here. The
 * cases and the assertions stay in the test -- this only reports.
 */
import { parse } from "../ast";
import { transformServerFns } from "../serverFns";

type Outcome = { code: string; parses: boolean } | { error: string };

async function run(name: string, code: string, target: "server" | "client") {
  try {
    const result = await transformServerFns(
      `${name}.ts`,
      code,
      target,
      new Set(),
    );
    const out = result?.code ?? code;
    let parses = true;
    try {
      await parse(`${name}.ts`, out);
    } catch {
      parses = false;
    }
    return { code: out, parses } satisfies Outcome;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    } satisfies Outcome;
  }
}

async function main() {
  const cases: Record<string, string> = JSON.parse(process.argv[2]!);
  const out: Record<string, { server: Outcome; client: Outcome }> = {};
  for (const [name, code] of Object.entries(cases)) {
    out[name] = {
      server: await run(name, code, "server"),
      client: await run(name, code, "client"),
    };
  }
  console.log(JSON.stringify(out));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
