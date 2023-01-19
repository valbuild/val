/** @type {import('next').NextConfig} */
const withPlugins = require("next-compose-plugins");
const withTM = require("next-transpile-modules")([
  "@valbuild/react",
  "@valbuild/lib",
]);

module.exports = withPlugins([withTM]);
