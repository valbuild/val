// @ts-check

/**
 * @param {import("../projectHost").ValProjectHost} host
 * @returns {import('eslint').Rule.RuleModule}
 */
export default (host) => ({
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure all .val files with export default c.define are referenced in val.modules",
      recommended: true,
    },
    schema: [], // No options needed
    messages: {
      missingFile:
        "'{{file}}' contains export default c.define but is not referenced in val.modules.ts or val.module.js.",
    },
  },
  create(context) {
    const referencedFiles = host.registeredModules(context.cwd);
    if (referencedFiles === null) {
      return {};
    }

    return {
      ExportDefaultDeclaration(node) {
        const filename = context.filename;
        if (filename?.includes(".val")) {
          if (
            node.declaration &&
            node.declaration.type === "CallExpression" &&
            node.declaration.callee.type === "MemberExpression" &&
            node.declaration.callee.object.type === "Identifier" &&
            node.declaration.callee.object.name === "c" &&
            node.declaration.callee.property.type === "Identifier" &&
            node.declaration.callee.property.name === "define" &&
            node.declaration.arguments &&
            node.declaration.arguments.length > 0
          ) {
            if (!referencedFiles.includes(filename)) {
              context.report({
                node,
                messageId: "missingFile",
                data: { file: host.displayPath(filename, context.cwd) },
              });
            }
          }
        }
      },
    };
  },
});
