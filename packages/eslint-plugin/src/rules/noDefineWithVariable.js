// @ts-check

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Cannot c.define with a variable",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    return {
      ExportDefaultDeclaration(node) {
        const decl = node.declaration;
        if (decl.type === "CallExpression") {
          const callee = decl.callee;
          const isDefine =
            callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "c" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "define";

          if (isDefine) {
            const args = decl.arguments;
            const valueArg = args[2];
            if (valueArg.type === "Identifier") {
              context.report({
                node: valueArg,
                message: "Val: third argument of c.define cannot be a variable",
              });
            }
          }
        }
      },
    };
  },
};
