// @ts-check
import path from "path";

const getExpectedValModuleName = (context) => {
  const filename = context.getFilename();
  if (filename.endsWith(".val.ts") || filename.endsWith(".val.js")) {
    const root = context.cwd || process.cwd();
    const relativePath = path.relative(root, filename);
    const expectedValue = relativePath.replace(/\.val\.(ts|js)$/, "");
    return `/${expectedValue}`;
  }
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Check that the first argument of export default declaration matches the string from val.config.ts file.",
      category: "Best Practices",
      recommended: "error",
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    const expectedValue = getExpectedValModuleName(context);
    return {
      ExportDefaultDeclaration(node) {
        if (!expectedValue) {
          return;
        }
        if (
          node.declaration &&
          node.declaration.arguments &&
          node.declaration.arguments.length > 0
        ) {
          const firstArg = node.declaration.arguments[0];
          if (firstArg.type === "TemplateLiteral") {
            context.report({
              node: firstArg,
              message:
                "val.content first argument should not be a template literal",
              fix: (fixer) => fixer.replaceText(firstArg, `"${expectedValue}"`),
            });
          }
          if (
            firstArg.type === "Literal" &&
            typeof firstArg.value === "string"
          ) {
            if (firstArg.value !== expectedValue) {
              context.report({
                node: firstArg,
                message: "val.content first argument must match filename",
                fix: (fixer) =>
                  fixer.replaceText(
                    firstArg,
                    `${firstArg.raw[0]}${expectedValue}${firstArg.raw[0]}`
                  ),
              });
            }
          }
        }
      },
    };
  },
};
