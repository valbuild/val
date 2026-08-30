const withPreconstruct = require("@preconstruct/next");

/**
 * The app is built with webpack, not Turbopack — `next dev --webpack` and
 * `next build --webpack` in the `package.json` scripts, and in the e2e suite's
 * second dev server in `playwright.config.ts`.
 *
 * `@preconstruct/next` works by patching the webpack config: it lets Next's
 * babel loader see the `@valbuild/*` sources that `preconstruct dev` points the
 * workspace packages' `main`/`module` at, and installs a loader for
 * `@preconstruct/hook`. Turbopack, the default since Next 16, ignores all of
 * that and refuses to build while a `webpack` config is present. Dropping to
 * Turbopack therefore means finding another way to consume the workspace
 * sources — until then the example stays on webpack.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // So a second `next dev` can run against this same directory: the e2e suite
  // starts one server in `fs` mode and one in `http` mode (proxy mode, talking to
  // the mock content host), and two dev servers sharing `.next` corrupt each
  // other's build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next 16 writes an AGENTS.md and CLAUDE.md into this directory on every `next
  // dev`, telling agents to read `node_modules/next/dist/docs`. This repo keeps
  // its own instructions (`.claude/CLAUDE.md`, `.agent/rules.md`), so the
  // generated pair would only be an untracked file that reappears after every
  // dev run.
  agentRules: false,
  images: {
    remotePatterns: [
      {
        hostname: "localhost",
      },
    ],
    localPatterns: [
      { 
        pathname: "/**",
      }
    ]
  },
};

module.exports = withPreconstruct(nextConfig);
