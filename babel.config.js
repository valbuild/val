/** @type {import("@babel/core").TransformOptions} */
module.exports = {
  presets: [
    "@babel/preset-env",
    // `allowDeclareFields` permits `declare foo: T` class fields, which are
    // type-only and emit nothing. Val uses them for phantom markers a type
    // needs and an instance must not have — see `__declaresRecordKeys` on
    // `LocaleSchema`. It is the default in Babel 8 and cannot change how any
    // existing code compiles: without it the syntax is simply an error.
    ["@babel/preset-typescript", { allowDeclareFields: true }],
  ],
  babelrcRoots: [".", "./packages/*"],
};
