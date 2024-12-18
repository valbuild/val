import j from "jscodeshift";

export function addEslintPluginToEslintMjs(
  fileInfo: j.FileInfo,
  api: j.API,
  options: j.Options,
) {
  if (!options.configImportPath) {
    throw new Error("configImportPath is required");
  }
  const root = api.jscodeshift(fileInfo.source);
  root
    .findVariableDeclarators("eslintConfig")
    .find(j.ArrayExpression)
    .find(j.SpreadElement)
    .find(j.CallExpression)
    .find(j.Literal)
    .at(-1)
    .insertAfter(j.literal("plugin:@valbuild/recommended"));

  return root.toSource();
}
