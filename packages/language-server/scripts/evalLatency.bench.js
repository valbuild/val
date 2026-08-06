/**
 * Latency benchmark for the evaluation core.
 *
 * NOT a test -- named `.bench.cjs` so jest ignores it. Run it by hand:
 *
 *     node packages/language-server/src/evalLatency.bench.cjs examples/next
 *
 * The question it answers: can we afford to evaluate a Val module through
 * QuickJS on every edit, or does the server need to debounce/degrade? Reports
 * cold start, warm re-evaluation, cache hits, and the edit-then-revalidate loop
 * that an editor actually produces.
 */
const path = require("path");
const fs = require("fs");

// Load through the package entry so preconstruct's require hook compiles the TS.
const { createValProject, mapOpenDocuments } = require("..");

function ms(t) {
  return `${(Number(t) / 1e6).toFixed(0)}ms`;
}
async function time(fn) {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  return [process.hrtime.bigint() - t0, r];
}
function stats(samples) {
  const sorted = [...samples].sort((a, b) => Number(a - b));
  const sum = sorted.reduce((a, b) => a + b, 0n);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    mean: sum / BigInt(sorted.length),
  };
}

async function main() {
  const valRoot = path.resolve(process.argv[2] || "examples/next");
  const modules = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".val.ts"))
        modules.push("/" + path.relative(valRoot, p).split(path.sep).join("/"));
    }
  })(valRoot);

  console.log(`valRoot : ${valRoot}`);
  console.log(`modules : ${modules.length}\n`);

  const open = mapOpenDocuments();
  const project = createValProject({ valRoot, open });

  // --- cold: first module pays QuickJS runtime + WASM startup ---
  const [coldT, cold] = await time(() => project.getModule(modules[0]));
  if (cold.status === "error") {
    console.error("INIT FAILED:", cold.error);
    process.exit(1);
  }
  console.log(`cold start (runtime boot + first module) : ${ms(coldT)}`);

  // --- warm: each remaining module, fresh eval ---
  const warm = [];
  for (const m of modules.slice(1)) {
    const [t, r] = await time(() => project.getModule(m));
    warm.push(t);
    const errs =
      r.status === "ok" && r.content.errors
        ? Object.keys(r.content.errors.validation || {}).length
        : 0;
    console.log(
      `  ${m.padEnd(42)} ${ms(t).padStart(7)}  ${
        r.status === "ok"
          ? r.content.errors
            ? `${errs} validation`
            : "valid"
          : "ERROR"
      }`,
    );
  }
  const w = stats(warm);
  console.log(
    `\nwarm eval (per module)  min ${ms(w.min)}  median ${ms(w.median)}  mean ${ms(
      w.mean,
    )}  max ${ms(w.max)}`,
  );

  // --- cache hit ---
  const [hitT, hit] = await time(() => project.getModule(modules[0]));
  console.log(`cache hit               ${ms(hitT)} (cached=${hit.cached})`);

  // --- the loop that matters: edit a buffer, then re-evaluate ---
  const target = modules[0];
  const abs = path.join(valRoot, target);
  const original = fs.readFileSync(abs, "utf8");
  const editSamples = [];
  for (let i = 0; i < 8; i++) {
    // Simulate a keystroke: change the buffer so the fingerprint differs.
    open.set(abs, original + `\n// keystroke ${i}\n`);
    const [t] = await time(() => project.getModule(target));
    editSamples.push(t);
  }
  const e = stats(editSamples);
  console.log(
    `edit -> revalidate      min ${ms(e.min)}  median ${ms(e.median)}  mean ${ms(
      e.mean,
    )}  max ${ms(e.max)}`,
  );

  console.log(`\ncacheSize: ${project.cacheSize()}`);
  await project.dispose();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
