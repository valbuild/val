export type ExplorerItemType = {
  name: string;
  isDirectory?: true;
  children: ExplorerItemType[];
};
export function pathTree(paths: string[]): ExplorerItemType {
  const allPaths: Record<string, ExplorerItemType> = {
    "/": {
      name: "/",
      isDirectory: true,
      children: [],
    },
  };
  for (const path of paths) {
    const parts = path.split("/");
    if (parts[0] !== "") {
      throw new Error("Expected path to start with '/'");
    }
    // skip first part which is always empty
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const fullPath = [dir, parts[i]].join("/");
      const name = parts[i];
      if (!name) {
        throw new Error("Expected name to be non-empty");
      }
      if (!allPaths[fullPath]) {
        const node: ExplorerItemType = {
          name,
          children: [],
        };
        const isDirectory = i < parts.length - 1;
        if (isDirectory) {
          node.isDirectory = true;
        }
        allPaths[fullPath] = node;
        allPaths[dir || "/"].children.push(allPaths[fullPath]);
        // we do not have to sort here... but most likely users will expect it
        allPaths[dir || "/"].children.sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      }
    }
  }
  return allPaths["/"];
}
