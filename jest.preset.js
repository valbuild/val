/** @type {import("@babel/core").TransformOptions} */
const babelOptions = {
  root: __dirname,
};

/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    "\\.[jt]sx?": ["babel-jest", babelOptions],
  },
};
