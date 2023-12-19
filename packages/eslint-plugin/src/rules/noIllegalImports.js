// @ts-check

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Check that val files only has valid imports.",
      recommended: true,
    },
    schema: [],
  },
  create: function (context) {
    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        const filename = context.filename || context.getFilename();

        const isValFile =
          filename.endsWith(".val.ts") || filename.endsWith(".val.js");
        // only allow: .val files, @valbuild packages, and val config
        if (
          isValFile &&
          typeof importSource === "string" &&
          !importSource.match(/\.val(\.ts|\.js|)$/) &&
          !importSource.match(/^@valbuild/) &&
          !importSource.match(/val\.config(\.ts|\.js|)$/)
        ) {
          if (
            "importKind" in node &&
            node["importKind"] !== "type" &&
            !node.specifiers.every(
              (s) => "importKind" in s && s["importKind"] === "type"
            )
          ) {
            const message = `Val: can only 'import type' or import from source that is either: a .val.{j,t}s file, a @valbuild package, or val.config.{j,t}s.`;
            context.report({
              node: node.source,
              message,
            });
          }
        }
      },
    };
  },
};
