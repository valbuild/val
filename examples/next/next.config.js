/** @type {import('next').NextConfig} */
const withPlugins = require("next-compose-plugins");
const withTM = require("next-transpile-modules")([
  "@valcms/react",
  "@valcms/lib",
]);

module.exports = withPlugins([withTM]);
