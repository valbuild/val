/**
 * Put the bundler's WebAssembly on the static host, if it is not already there.
 *
 * The static host is the content service's `/v1/static` (`DEFAULT_STATIC_HOST`
 * in `@valbuild/core`). It answers a GET with a 302 to a public bucket, and a
 * PUT with the upload token by writing the bytes there -- after checking they
 * hash to the digest in the URL.
 *
 * The Studio builds a managed project in the tab, so it needs
 * `@rolldown/browser`'s 10.9 MB binary -- and that binary cannot travel in the
 * npm package: `/api/val/static` is a base64 record of TEXT inside the server
 * bundle, and `@valbuild/tanstack-build`'s `wire.ts` declares `@valbuild/ui` as
 * a project dependency, so anything embedded there lands in every project's
 * vendor layer. `build/rolldownWasm.ts` has the measurements.
 *
 * ## Why this cannot get out of step with a release
 *
 * The binary is addressed by the SHA-256 of its own bytes, and the built bundle
 * asks for that exact digest. So there is no version number to keep in step:
 * either the object with this digest is on the host, or the Studio 404s and
 * says so. This script's whole job is "put it if it is absent", which is
 * idempotent and safe to run on every release, including one that did not
 * change rolldown at all.
 *
 * "Already there" is asked the way a browser asks it, not with a bare HEAD:
 * the Studio fetches this from a cross-origin-isolated document, so the
 * redirect and the bucket's answer both have to carry
 * `Access-Control-Allow-Origin`, and the redirect has to carry
 * `Cross-Origin-Resource-Policy`. An object that exists and a browser cannot
 * read is uploaded again, because content re-applies the bucket's CORS rules on
 * every upload. That is the common case being cheap, not skipped:
 * `@rolldown/browser` moves far more slowly than `@valbuild/ui` does, so most
 * releases find the object already there.
 *
 * ## Running it
 *
 *     pnpm --filter @valbuild/ui run rolldown:upload
 *
 * It reads `server/rolldown-wasm.json`, which the SPA build writes, so the
 * package must have been built first, and it uploads to exactly the URL that
 * manifest names -- so a build made with `VAL_STATIC_HOST` set uploads there,
 * and nothing here can point a release at a host its bundle does not ask.
 * `VAL_STATIC_UPLOAD_TOKEN` is the credential, and it must be the value the
 * content service has under the same name.
 *
 * With `--check` it uploads nothing and exits non-zero when the object is
 * missing or a browser could not fetch it. That is the form to run AFTER a
 * release, as the assertion that what was published can actually work.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/*
 * `fileURLToPath`, not `new URL(...).pathname`: a checkout under a path with a
 * space in it comes back percent-encoded from `pathname`, and every path built
 * from it then points at a directory that does not exist.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, "..", "server", "rolldown-wasm.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  if (!fs.existsSync(MANIFEST)) {
    fail(
      `${MANIFEST} does not exist. Build the package first -- the SPA build ` +
        `writes it, and it names the exact bytes this release asks for.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  const { url, sha256, bytes, filename } = manifest;

  /*
   * A host that cannot be reached is not an absent object.
   *
   * `fetch` throws on DNS and TLS failures, and an unhandled one reports
   * "fetch failed" and nothing else -- which reads as "the binary is missing"
   * when it means "this machine has no route to the host", and those call for
   * opposite actions.
   */
  let problems;
  try {
    problems = await browserProblems(url);
  } catch (error) {
    fail(
      `Could not reach ${url} to find out whether the binary is already ` +
        `there: ${error?.message ?? error}. Nothing was uploaded, and this is ` +
        `not evidence either way.`,
    );
  }
  if (problems.length === 0) {
    console.log(
      `Already on the static host, and a browser can fetch it: ${url}`,
    );
    return;
  }
  if (checkOnly) {
    fail(
      `A Studio built from this release cannot publish: it fetches ${url} ` +
        `from inside rolldown's loader, and\n  - ${problems.join("\n  - ")}\n` +
        `Run 'pnpm --filter @valbuild/ui run rolldown:upload'.`,
    );
  }
  console.log(`Not fetchable yet:\n  - ${problems.join("\n  - ")}`);

  const token = process.env.VAL_STATIC_UPLOAD_TOKEN;
  if (!token) {
    fail(
      `VAL_STATIC_UPLOAD_TOKEN is not set, and ${url} is not on the static ` +
        `host yet. Nothing was uploaded.`,
    );
  }

  /*
   * Resolved through `@valbuild/tanstack-build`, which is the package that
   * declares the dependency -- resolving from here would find whatever a hoist
   * happened to put in reach. The same walk as `findRolldownWasm` in
   * `build/rolldownWasm.ts`, repeated rather than imported because that file is
   * TypeScript and this script is run by plain node during a release.
   *
   * The digest check below is what makes the duplication safe: if the two ever
   * disagree about which file they mean, these bytes do not hash to what the
   * built bundle asks for and nothing is uploaded.
   */
  const fromHere = createRequire(path.join(HERE, "noop.js"));
  const fromBuilder = createRequire(
    fromHere.resolve("@valbuild/tanstack-build/package.json"),
  );
  const file = path.join(
    path.dirname(fromBuilder.resolve("@rolldown/browser/package.json")),
    "dist",
    filename,
  );
  const actual = createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
  if (actual !== sha256) {
    fail(
      `The installed @rolldown/browser is not the one this build was made ` +
        `against: ${file} hashes to ${actual}, and the bundle asks for ` +
        `${sha256}. Reinstall, rebuild, and run this again -- uploading these ` +
        `bytes would put the wrong binary at the right URL, which is the one ` +
        `failure content addressing exists to make impossible.`,
    );
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/wasm",
      "content-length": String(bytes),
    },
    body: fs.readFileSync(file),
  });
  if (!response.ok) {
    fail(
      `Uploading ${filename} to ${url} failed with ${response.status} ` +
        `${response.statusText}.`,
    );
  }
  console.log(`Uploaded ${bytes} bytes to ${url}`);

  const after = await browserProblems(url);
  if (after.length > 0) {
    fail(
      `Uploaded, but a browser still could not fetch ${url}:\n  - ` +
        after.join("\n  - "),
    );
  }
  console.log("...and a browser can fetch it.");
}

/**
 * What would stop a cross-origin-isolated Studio fetching this URL, as
 * sentences; empty when nothing would.
 *
 * The two hops are asked separately because they fail separately: the redirect
 * is content's and the object is the bucket's, and "Failed to fetch" in a
 * browser names neither. A redirected CORS fetch is checked at EVERY hop, so
 * both must send `Access-Control-Allow-Origin`.
 */
async function browserProblems(url) {
  const origin = { Origin: "https://studio.invalid" };
  const problems = [];
  const hop = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    headers: origin,
  });
  const location = hop.headers.get("location");
  if (hop.status >= 300 && hop.status < 400 && location) {
    if (hop.headers.get("access-control-allow-origin") === null) {
      problems.push(
        `the redirect (${hop.status}) sends no Access-Control-Allow-Origin`,
      );
    }
    if (hop.headers.get("cross-origin-resource-policy") !== "cross-origin") {
      problems.push(
        `the redirect sends no Cross-Origin-Resource-Policy: cross-origin`,
      );
    }
    const target = await fetch(new URL(location, url), {
      method: "HEAD",
      headers: origin,
    });
    if (!target.ok) {
      problems.push(`the object at ${location} answered ${target.status}`);
    } else if (target.headers.get("access-control-allow-origin") === null) {
      problems.push(
        `the object at ${location} sends no Access-Control-Allow-Origin`,
      );
    }
  } else if (!hop.ok) {
    problems.push(`${url} answered ${hop.status}`);
  } else if (hop.headers.get("access-control-allow-origin") === null) {
    problems.push(`${url} sends no Access-Control-Allow-Origin`);
  }
  return problems;
}

main().catch((error) => fail(error?.message ?? String(error)));
