/**
 * `collectCss` on three small projects, reporting what it named as missing.
 * See cssMissing.test.ts. A separate process because rolldown, which parses
 * the modules, is ESM-only and jest runs CommonJS here.
 */
import "./nativeBundler";
import { collectCss } from "../css";

(async () => {
  const studio = await collectCss(
    {
      "src/entry.tsx": `import "./routes/__root";\n`,
      "src/routes/__root.tsx": `import "../styles.css";\nimport "./here.css";\nexport const x = 1;\n`,
      "src/routes/here.css": `.here { color: red; }`,
    },
    "src/entry.tsx",
  );
  const whole = await collectCss(
    {
      "src/entry.tsx": `import "./styles.css?url";\n`,
      "src/styles.css": `h1 {}`,
    },
    "src/entry.tsx",
  );
  const notCss = await collectCss(
    { "src/entry.tsx": `import "./gone";\n` },
    "src/entry.tsx",
  );
  process.stdout.write(
    `${JSON.stringify({
      studio: { missing: studio.missing, code: studio.code },
      whole: whole.missing,
      notCss: notCss.missing,
    })}\n`,
  );
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
