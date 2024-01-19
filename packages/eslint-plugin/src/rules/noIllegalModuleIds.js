// @ts-check
import path from "path";

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Check that the first argument of export default declaration matches the string from val.config.{j,t}s file.",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    return {
      ExportDefaultDeclaration(node) {
        /**
         * @type {string | undefined}
         */
        let expectedValue;
        if (node.parent.type === "Program") {
          const maybeValConfigImportDeclaration = node.parent.body.find((n) =>
            n.type === "ImportDeclaration" &&
            typeof n.source.value === "string" &&
            (n.source.value.endsWith("val.config") ||
              n.source.value.endsWith("val.config.ts") ||
              n.source.value.endsWith("val.config.js"))
              ? n.source.value
              : false
          );
          if (
            maybeValConfigImportDeclaration?.type === "ImportDeclaration" &&
            typeof maybeValConfigImportDeclaration.source.value === "string"
          ) {
            const valConfigImportSource =
              maybeValConfigImportDeclaration.source.value;
            const filename = context.filename || context.getFilename();
            if (
              filename?.endsWith(".val.ts") ||
              filename?.endsWith(".val.js")
            ) {
              const root = context.cwd || process.cwd();
              const relativePath = path.relative(root, filename);
              expectedValue = relativePath.replace(/\.val\.(ts|js)$/, "");
              // TODO: this feels like a weird way to figure out the correct relative path,
              // in a monorepo, the root dir will be the root of the monorepo, not the root of the package
              // so we need to account for that
              // Assume the import of the val.config is correct and that it is in the root folder
              const numberOfDirsToRoot = valConfigImportSource
                .split(".." + path.sep)
                .reduce((acc, curr) => (curr === "" ? acc + 1 : acc), 0);
              const pathSegments = expectedValue.split(path.sep);
              expectedValue = `/${path.join(
                ...pathSegments.slice(
                  pathSegments.length - (numberOfDirsToRoot + 1),
                  pathSegments.length
                )
              )}`;
            }
          }
        } else {
          console.warn("Unexpected parent type", node.parent.type);
        }
        if (!expectedValue) {
          return;
        }
        if (
          node.declaration &&
          node.declaration.type === "CallExpression" &&
          node.declaration.arguments &&
          node.declaration.arguments.length > 0
        ) {
          const firstArg = node.declaration.arguments[0];
          if (firstArg.type === "TemplateLiteral") {
            context.report({
              node: firstArg,
              message: "Val: c.define id should not be a template literal",
              fix: (fixer) => fixer.replaceText(firstArg, `"${expectedValue}"`),
            });
          }
          if (
            firstArg.type === "Literal" &&
            typeof firstArg.value === "string"
          ) {
            if (firstArg.value !== expectedValue) {
              const rawArg = firstArg.raw?.[0];
              if (rawArg) {
                context.report({
                  node: firstArg,
                  message: `Val: c.define id should match the filename. Expected: '${expectedValue}'. Found: '${firstArg.value}'`,
                  fix: (fixer) =>
                    fixer.replaceText(
                      firstArg,
                      `${rawArg}${expectedValue}${rawArg}`
                    ),
                });
              }
            }
          }
        }
      },
    };
  },
};
