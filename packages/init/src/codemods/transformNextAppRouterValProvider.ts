import j from "jscodeshift";

export function transformNextAppRouterValProvider(
  fileInfo: j.FileInfo,
  api: j.API,
  options: j.Options,
) {
  if (!options.configImportPath) {
    throw new Error("configImportPath is required");
  }
  if (!options.valModulesClientImportPath) {
    throw new Error("valModulesClientImportPath is required");
  }
  const root = api.jscodeshift(fileInfo.source);
  root
    .find(j.ImportDeclaration)
    .at(0)
    .insertBefore(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("ValProvider"))],
        j.literal("@valbuild/next"),
      ),
    )
    .insertBefore(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("config"))],
        j.literal(options.configImportPath),
      ),
    )
    .insertBefore(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("ValModulesClient"))],
        j.literal(options.valModulesClientImportPath),
      ),
    );
  root
    .findJSXElements("body")
    .childNodes()
    .forEach((el) => {
      if (el.value.type === "JSXExpressionContainer") {
        if (
          el.value.expression.type === "Identifier" &&
          el.value.expression.name === "children"
        ) {
          el.replace(
            j.jsxElement(
              {
                name: {
                  type: "JSXIdentifier",
                  name: "ValProvider",
                },
                type: "JSXOpeningElement",
                selfClosing: false,
                attributes: [
                  {
                    type: "JSXAttribute",
                    name: {
                      type: "JSXIdentifier",
                      name: "config",
                    },
                    value: {
                      type: "JSXExpressionContainer",
                      expression: {
                        type: "Identifier",
                        name: "config",
                      },
                    },
                  },
                  // Boolean shorthand: <ValProvider config={config} suspend>.
                  // The Val Enable cookie is detected client-side by
                  // ValProvider, so the layout stays synchronous and static.
                  {
                    type: "JSXAttribute",
                    name: {
                      type: "JSXIdentifier",
                      name: "suspend",
                    },
                    value: null,
                  },
                ],
              },
              {
                name: {
                  type: "JSXIdentifier",
                  name: "ValProvider",
                },
                type: "JSXClosingElement",
              },
              [
                j.jsxElement(
                  j.jsxOpeningElement(
                    j.jsxIdentifier("ValModulesClient"),
                    [],
                    true,
                  ),
                ),
                j.jsxExpressionContainer(j.identifier("children")),
              ],
            ),
          );
        }
      }
    });
  return root.toSource();
}
