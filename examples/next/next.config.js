const withPreconstruct = require("@preconstruct/next");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // So a second `next dev` can run against this same directory: the e2e suite
  // starts one server in `fs` mode and one in `http` mode (proxy mode, talking to
  // the mock content host), and two dev servers sharing `.next` corrupt each
  // other's build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      {
        hostname: "localhost",
      },
    ],
  },
};

module.exports = withPreconstruct(nextConfig);
