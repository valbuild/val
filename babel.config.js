/** @type {import("@babel/core").TransformOptions} */
module.exports = {
  presets: ["@babel/preset-env", "@babel/preset-typescript"],
  babelrcRoots: [".", "./packages/*"],
};
