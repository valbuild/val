/** @type {import('next').NextConfig} */
const withPlugins = require("next-compose-plugins");
const withTM = require("next-transpile-modules")(["@val/react", "@val/lib"]);

module.exports = withPlugins([withTM]);
