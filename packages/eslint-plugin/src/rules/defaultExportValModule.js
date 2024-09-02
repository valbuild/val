// @ts-check

const message = "Val: c.define must be exported as default";
/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "c.define must be exported as default",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "MemberExpression") {
          const memberExpression = node.callee;
          if (memberExpression.object.type === "Identifier") {
            const object = memberExpression.object;
            if (
              object.name === "c" &&
              memberExpression.property.type === "Identifier"
            ) {
              const property = memberExpression.property;
              if (property.name === "define") {
                const parent = node.parent;
                if (parent.type === "ExportDefaultDeclaration") {
                  return;
                }
                if (parent.type === "VariableDeclarator") {
                  const variableInit = parent.init;
                  if (
                    variableInit &&
                    parent.parent.type === "VariableDeclaration"
                  ) {
                    context.report({
                      node: node,
                      message,
                      fix: function (fixer) {
                        return fixer.replaceText(
                          parent.parent,
                          `export default ${context.sourceCode.getText(
                            variableInit,
                          )}`,
                        );
                      },
                    });
                  } else {
                    context.report({
                      node: node,
                      message,
                    });
                  }
                } else if (
                  parent.type === "ExpressionStatement" &&
                  parent.parent.type === "Program"
                ) {
                  context.report({
                    node: node,
                    message,
                    fix: function (fixer) {
                      return fixer.replaceText(
                        parent,
                        `export default ${context.sourceCode.getText(parent)}`,
                      );
                    },
                  });
                } else {
                  context.report({
                    node: node,
                    message,
                  });
                }
              }
            }
          }
        }
      },
    };
  },
};
