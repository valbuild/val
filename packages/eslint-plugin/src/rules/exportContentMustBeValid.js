// @ts-check

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Export c.define should only happen in .val files.",
      recommended: true,
    },
    messages: {
      "val/export-content-must-be-valid":
        "Val: c.define should only be exported from .val files",
    },
    schema: [],
  },
  create: function (context) {
    return {
      ExportDefaultDeclaration(node) {
        if (
          node.declaration &&
          node.declaration.type === "CallExpression" &&
          node.declaration.callee.type === "MemberExpression" &&
          node.declaration.callee.object.type === "Identifier" &&
          node.declaration.callee.object.name === "c" &&
          node.declaration.callee.property.type === "Identifier" &&
          node.declaration.callee.property.name === "define"
        ) {
          const filename = context.filename || context.getFilename();
          if (
            !(filename?.endsWith(".val.ts") || filename?.endsWith(".val.js"))
          ) {
            context.report({
              node: node.declaration.callee,
              messageId: "val/export-content-must-be-valid",
            });
          }
        }
      },
    };
  },
};
