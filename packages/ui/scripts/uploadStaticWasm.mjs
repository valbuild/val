/**
 * Put the Studio's WebAssembly on the static host, where it is not already.
 *
 * The static host is the content service's `/v1/static` (`DEFAULT_STATIC_HOST`
 * in `@valbuild/core`). It answers a GET with a 302 to a public bucket, and a
 * PUT with the upload token by writing the bytes there -- after checking they
 * hash to the digest in the URL.
 *
 * The binaries are rolldown's (10.9 MB, which the Studio builds a managed
 * project with) and libwebp's (two builds, ~300 KB each, which writes WebP
 * where the canvas cannot). None can travel in the npm package:
 * `/api/val/static` is a base64 record of TEXT inside the server bundle, and
 * `@valbuild/tanstack-build`'s `wire.ts` declares `@valbuild/ui` as a project
 * dependency, so anything embedded there lands in every project's vendor layer.
 * `build/staticWasm.ts` has the measurements.
 *
 * ## Why this cannot get out of step with a release
 *
 * Each binary is addressed by the SHA-256 of its own bytes, and the built
 * bundle asks for that exact digest. So there is no version number to keep in
 * step: either the object with this digest is on the host, or the Studio 404s
 * and says so. This script's whole job is "put it if it is absent", which is
 * idempotent and safe to run on every release, including one that changed none
 * of them.
 *
 * "Already there" is asked the way a browser asks it, not with a bare HEAD:
 * the Studio fetches these from a cross-origin-isolated document, so the
 * redirect and the bucket's answer both have to carry
 * `Access-Control-Allow-Origin`, and the redirect has to carry
 * `Cross-Origin-Resource-Policy`. An object that exists and a browser cannot
 * read is uploaded again, because content re-applies the bucket's CORS rules on
 * every upload. That is the common case being cheap, not skipped: these
 * packages move far more slowly than `@valbuild/ui` does, so most releases find
 * every object already there and need no token.
 *
 * ## Running it
 *
 *     pnpm --filter @valbuild/ui run wasm:upload
 *
 * It reads `server/static-wasm.json`, which the SPA build writes, so the
 * package must have been built first, and it uploads to exactly the URLs that
 * manifest names -- so a build made with `VAL_STATIC_HOST` set uploads there,
 * and nothing here can point a release at a host its bundle does not ask.
 * `VAL_STATIC_UPLOAD_TOKEN` is the credential, and it must be the value the
 * content service has under the same name.
 *
 * With `--check` it uploads nothing and exits non-zero when an object is
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
const MANIFEST = path.join(HERE, "..", "server", "static-wasm.json");

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
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(
      `${MANIFEST} lists no binaries. It was written by a build older than ` +
        `this script, or by a broken one; rebuild the package.`,
    );
  }
  /*
   * Every binary before any upload, so a release that is missing two finds out
   * about both -- and about a missing token -- in one run.
   */
  const missing = [];
  for (const entry of manifest.files) {
    const problems = await problemsOf(entry.url);
    if (problems.length === 0) {
      console.log(
        `Already on the static host, and a browser can fetch it: ${entry.url}`,
      );
    } else {
      missing.push({ entry, problems });
    }
  }
  if (missing.length === 0) {
    return;
  }
  if (checkOnly) {
    fail(
      `A Studio built from this release is missing WebAssembly it loads:\n` +
        missing
          .map(
            ({ entry, problems }) =>
              `${entry.url}\n  - ${problems.join("\n  - ")}`,
          )
          .join("\n") +
        `\nRun 'pnpm --filter @valbuild/ui run wasm:upload'.`,
    );
  }
  for (const { entry, problems } of missing) {
    console.log(
      `Not fetchable yet: ${entry.url}\n  - ${problems.join("\n  - ")}`,
    );
  }

  const token = process.env.VAL_STATIC_UPLOAD_TOKEN;
  if (!token) {
    fail(
      `VAL_STATIC_UPLOAD_TOKEN is not set, and ` +
        `${missing.map(({ entry }) => entry.url).join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} not on the static host yet. ` +
        `Nothing was uploaded.`,
    );
  }
  for (const { entry } of missing) {
    await upload(entry, token);
  }
}

/**
 * The same walk as `locateWasm` in `build/staticWasm.ts`: each package
 * resolved from the one before it, starting here. Repeated rather than
 * imported because that file is TypeScript and this script is run by plain
 * node during a release -- but the LIST comes from the manifest the build
 * wrote, so the two cannot disagree about which binaries there are.
 *
 * The digest check in `upload` is what makes the duplication safe: if the two
 * ever disagree about which file they mean, these bytes do not hash to what the
 * built bundle asks for and nothing is uploaded.
 */
function locate(entry) {
  let from = path.join(HERE, "noop.js");
  for (const pkg of entry.resolveThrough) {
    from = createRequire(from).resolve(`${pkg}/package.json`);
  }
  return path.join(path.dirname(from), entry.path);
}

async function upload(entry, token) {
  const { url, sha256, bytes, filename } = entry;
  const file = locate(entry);
  const actual = createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
  if (actual !== sha256) {
    fail(
      `The installed ${entry.resolveThrough.at(-1)} is not the one this ` +
        `build was made against: ${file} hashes to ${actual}, and the bundle ` +
        `asks for ${sha256}. Reinstall, rebuild, and run this again -- ` +
        `uploading these bytes would put the wrong binary at the right URL, ` +
        `which is the one failure content addressing exists to make ` +
        `impossible.`,
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
 * {@link browserProblems}, with a host that cannot be reached reported as
 * that rather than as an absent object.
 *
 * `fetch` throws on DNS and TLS failures, and an unhandled one reports
 * "fetch failed" and nothing else -- which reads as "the binary is missing"
 * when it means "this machine has no route to the host", and those call for
 * opposite actions.
 */
async function problemsOf(url) {
  try {
    return await browserProblems(url);
  } catch (error) {
    fail(
      `Could not reach ${url} to find out whether the binary is already ` +
        `there: ${error?.message ?? error}. Nothing was uploaded, and this is ` +
        `not evidence either way.`,
    );
  }
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
