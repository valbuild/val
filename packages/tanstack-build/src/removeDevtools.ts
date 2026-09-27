// Removes TanStack Devtools from a production build.
//
// `@tanstack/react-devtools` has no production no-op: it renders its panel
// whatever NODE_ENV says. What keeps it off a normal site is the
// `@tanstack/devtools:remove-devtools-on-build` transform that the `devtools()`
// plugin in a project's vite.config.ts adds to every `vite build`. That plugin
// never runs here -- this builder reads no vite.config -- so a template that
// renders `<TanStackDevtools>` unconditionally, as the starter does, shipped the
// panel to every visitor of a published site.
//
// A direct port of `removeDevtools` in `@tanstack/devtools-bundler-core`
// (remove-devtools.ts, 0.1.x), so the two stay checkable against each other:
//
//   1. every import from a devtools package goes, and its local names are kept;
//   2. every JSX element named by one of those goes -- removed when it is a JSX
//      child, replaced with `null` anywhere else so the expression stays valid;
//   3. the panels named in its `plugins` prop (`render: <RouterPanel />`) lose
//      their import specifiers, so the router devtools are not bundled for an
//      element nobody renders.
//
// Where this is deliberately NOT a port, because upstream can emit a module
// that does not parse or does not link -- a build error on a valid project:
//
//   - a `null` stand-in ends at the element. Upstream swallows the newline
//     after it too, so semicolonless `const p = <Devtools />\nconst n = 1`
//     became `const p = nullconst n = 1`.
//   - a panel keeps its import while anything outside the removed elements
//     still refers to it, and a devtools name that is referred to outside JSX
//     (`const D = TanStackDevtools`) becomes a stub instead of vanishing.
//     Upstream deletes both imports and leaves the references dangling.
//   - a bare `import "@tanstack/react-devtools"` goes too. It has no names, and
//     upstream returned early on "no names" after deciding to remove it.
//   - a partly-removed import keeps its default specifier where it was, and a
//     default-imported panel is removed like a named one. Upstream rewrote the
//     rest as `import { ... }`, which turns a default into a named import.
import { applyEdits, parse, walk, type Edit, type Node } from "./ast";

/** `TANSTACK_DEVTOOLS_PACKAGES` upstream. Exact specifiers, not prefixes. */
export const TANSTACK_DEVTOOLS_PACKAGES = [
  "@tanstack/react-devtools",
  "@tanstack/preact-devtools",
  "@tanstack/solid-devtools",
  "@tanstack/vue-devtools",
  "@tanstack/svelte-devtools",
  "@tanstack/angular-devtools",
  "@tanstack/devtools",
];

const isDevtoolsImport = (source: unknown) =>
  typeof source === "string" && TANSTACK_DEVTOOLS_PACKAGES.includes(source);

/** Through the newline after `node`, so a removed statement leaves no blank line. */
const endOfLine = (code: string, node: Node) =>
  code[node.end] === "\n" ? node.end + 1 : node.end;

/** The element name a `render` value renders: `<X />`, `() => <X />`, `X`, `X()`. */
function renderedName(value: Node | undefined): string | null {
  if (!value) return null;
  const elementName = (element: Node | undefined) =>
    element?.type === "JSXElement" &&
    element.openingElement.name.type === "JSXIdentifier"
      ? String(element.openingElement.name.name)
      : null;
  if (value.type === "JSXElement") return elementName(value);
  if (
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression"
  )
    return elementName(value.body);
  if (value.type === "Identifier") return String(value.name);
  if (value.type === "CallExpression" && value.callee.type === "Identifier")
    return String(value.callee.name);
  return null;
}

/** `getPluginReferences` upstream: the panels a devtools element's `plugins` renders. */
function pluginReferences(opening: Node) {
  const refs: Array<string> = [];
  for (const attr of opening.attributes as Array<Node>) {
    if (attr.type !== "JSXAttribute") continue;
    if (attr.name.type !== "JSXIdentifier" || attr.name.name !== "plugins")
      continue;
    const expression = attr.value?.expression as Node | undefined;
    if (
      attr.value?.type !== "JSXExpressionContainer" ||
      expression?.type !== "ArrayExpression"
    )
      continue;
    for (const element of expression.elements as Array<Node | null>) {
      if (element?.type !== "ObjectExpression") continue;
      for (const prop of element.properties as Array<Node>) {
        if (prop.type !== "Property" || prop.key.type !== "Identifier")
          continue;
        if (prop.key.name !== "render") continue;
        const name = renderedName(prop.value);
        if (name) refs.push(name);
      }
    }
  }
  return refs;
}

function isDevtoolsElement(opening: Node, names: Set<string>) {
  const name = opening.name as Node;
  if (name.type === "JSXIdentifier") return names.has(String(name.name));
  return (
    name.type === "JSXMemberExpression" &&
    name.object.type === "JSXIdentifier" &&
    names.has(String(name.object.name))
  );
}

/**
 * Edits whose range sits inside another edit's are dropped.
 *
 * MagicString, which upstream splices with, tolerates overlapping removals;
 * `applyEdits` does not, and a devtools element nested inside another one --
 * or inside a panel being removed -- would otherwise splice twice.
 */
function outermost(edits: Array<Edit>) {
  return edits.filter(
    (edit) =>
      !edits.some(
        (other) =>
          other !== edit &&
          other.start <= edit.start &&
          other.end >= edit.end &&
          (other.start < edit.start || other.end > edit.end),
      ),
  );
}

/**
 * Whether `node` -- an identifier named like a binding -- is a READ of it,
 * rather than a name in some other role: a non-computed property or key, a JSX
 * attribute name, the right half of `<A.B>`.
 */
function isReference(node: Node, parent: Node | undefined) {
  if (!parent) return true;
  switch (parent.type) {
    case "MemberExpression":
      return parent.object === node || parent.computed;
    case "JSXMemberExpression":
      return parent.object === node;
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      // A shorthand `{ X }` has its own value node, which is the read.
      return parent.key !== node || parent.computed;
    case "JSXAttribute":
      return parent.name !== node;
    default:
      return true;
  }
}

/**
 * The local names in `names` read anywhere outside `removed`.
 *
 * Import declarations are not walked: a specifier is a binding, not a read, and
 * every one of them is either being removed or being kept anyway.
 */
function readOutside(ast: Node, names: Set<string>, removed: Array<Edit>) {
  const found = new Set<string>();
  const inRemoved = (node: Node) =>
    removed.some((edit) => edit.start <= node.start && node.end <= edit.end);
  for (const statement of ast.body as Array<Node>) {
    if (statement.type === "ImportDeclaration") continue;
    walk(statement, (node, stack) => {
      if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return;
      const name = String(node.name);
      if (!names.has(name) || found.has(name)) return;
      if (!isReference(node, stack[stack.length - 1])) return;
      if (!inRemoved(node)) found.add(name);
    });
  }
  return found;
}

/**
 * What a devtools binding becomes when something besides a removed element
 * still reads it: a component that renders nothing, or a namespace of them.
 */
function stubFor(specifier: Node) {
  const local = String(specifier.local.name);
  return specifier.type === "ImportNamespaceSpecifier"
    ? `const ${local} = new Proxy({}, { get: () => () => null });`
    : `const ${local} = () => null;`;
}

/**
 * Strips TanStack Devtools from one module.
 *
 * Both targets, as upstream does: the plugin applies to the client and the SSR
 * build alike. Returns `null` when there is nothing to remove, so the caller
 * leaves the module alone and pays no parse.
 */
export async function transformRemoveDevtools(
  moduleId: string,
  code: string,
): Promise<{ code: string } | null> {
  if (!TANSTACK_DEVTOOLS_PACKAGES.some((pkg) => code.includes(pkg)))
    return null;

  let ast: Node;
  try {
    ast = await parse(moduleId, code);
  } catch {
    // Upstream gives up on a parse error too, and rolldown reports the error
    // itself -- with a better message than this pass could.
    return null;
  }

  const devtoolsImports = (ast.body as Array<Node>).filter(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      isDevtoolsImport(statement.source?.value),
  );
  if (devtoolsImports.length === 0) return null;
  const devtoolsNames = new Set<string>();
  for (const statement of devtoolsImports)
    for (const specifier of (statement.specifiers ?? []) as Array<Node>)
      devtoolsNames.add(String(specifier.local.name));

  // The elements first: whether an import can simply go depends on whether
  // anything outside them still reads its names.
  const elements: Array<Edit> = [];
  const panels = new Set<string>();
  if (devtoolsNames.size > 0) {
    walk(ast, (node, stack) => {
      if (node.type !== "JSXElement") return;
      const opening = node.openingElement as Node;
      if (!isDevtoolsElement(opening, devtoolsNames)) return;
      for (const panel of pluginReferences(opening)) panels.add(panel);
      const parent = stack[stack.length - 1];
      // Only a JSX child can simply vanish, and take its line with it.
      // Anywhere else -- a return, a `&&`, an initialiser -- the element is an
      // expression and needs a stand-in, which must end where the element
      // did: the newline after it may be the only thing ending the statement.
      const inJsx =
        parent?.type === "JSXElement" || parent?.type === "JSXFragment";
      elements.push(
        inJsx
          ? { start: node.start, end: endOfLine(code, node), text: "" }
          : { start: node.start, end: node.end, text: "null" },
      );
    });
  }
  const removed = outermost(elements);
  const stillRead = readOutside(
    ast,
    new Set([...devtoolsNames, ...panels]),
    removed,
  );

  const edits: Array<Edit> = [...removed];
  for (const statement of devtoolsImports) {
    const stubs = ((statement.specifiers ?? []) as Array<Node>)
      .filter((specifier) => stillRead.has(String(specifier.local.name)))
      .map(stubFor);
    edits.push(
      stubs.length > 0
        ? { start: statement.start, end: statement.end, text: stubs.join(" ") }
        : { start: statement.start, end: endOfLine(code, statement), text: "" },
    );
  }

  if (panels.size > 0) {
    for (const statement of ast.body as Array<Node>) {
      if (statement.type !== "ImportDeclaration") continue;
      if (isDevtoolsImport(statement.source?.value)) continue;
      const specifiers = (statement.specifiers ?? []) as Array<Node>;
      const dropped = specifiers.filter((specifier) => {
        const local = String(specifier.local.name);
        return (
          specifier.type !== "ImportNamespaceSpecifier" &&
          panels.has(local) &&
          !stillRead.has(local)
        );
      });
      if (dropped.length === 0) continue;
      const remaining = specifiers.filter((s) => !dropped.includes(s));
      if (remaining.length === 0) {
        edits.push({
          start: statement.start,
          end: endOfLine(code, statement),
          text: "",
        });
        continue;
      }
      const text = (node: Node) => code.slice(node.start, node.end);
      const defaults = remaining
        .filter((s) => s.type !== "ImportSpecifier")
        .map(text);
      const named = remaining
        .filter((s) => s.type === "ImportSpecifier")
        .map(text);
      const clause = [
        ...defaults,
        ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : []),
      ].join(", ");
      edits.push({
        start: statement.start,
        end: statement.end,
        text: `import ${clause} from ${text(statement.source)};`,
      });
    }
  }

  return { code: applyEdits(code, edits) };
}
