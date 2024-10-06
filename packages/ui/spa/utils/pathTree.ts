export type PathNode = {
  name: string;
  fullPath: string;
  isDirectory?: true;
  children: PathNode[];
};
export function pathTree(filePaths: string[]): PathNode {
  const allPaths: Record<string, PathNode> = {
    "/": {
      name: "/",
      fullPath: "/",
      isDirectory: true,
      children: [],
    },
  };
  // How this works:
  // For each path we split it into parts: "/content/projects.val.ts" -> ["", "content", "projects.val.ts"]
  // We skip the first part which is always empty
  // Then we iterate over the parts, ensuring that all the sub-directories of a file are created
  // For the above example we would create:
  //   1. the "/content" dir,
  //   2. add it to the root ("/"),
  //   3. then the "/content/projects.val.ts" file, and
  //   4. add it to the "/content" dir
  // Obviously, if a sub-directory already exists we do not create it again, so this works for multiple files in the same directory
  for (const path of filePaths) {
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
        const node: PathNode = {
          name,
          fullPath,
          children: [],
        };
        const isDirectory = i < parts.length - 1;
        if (isDirectory) {
          node.isDirectory = true;
        }
        allPaths[fullPath] = node;
        allPaths[dir || "/"].children.push(allPaths[fullPath]);
      }
    }
  }
  return allPaths["/"];
}
