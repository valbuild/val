import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";

export type PageNode = {
  type: "leaf";
  name: string;
  fullPath?: string;
  moduleFilePath: ModuleFilePath;
  sourcePath: SourcePath | ModuleFilePath;
  pattern?: string; // if a pattern is present you can add new children to this node
  children: (SitemapNode | PageNode)[];
};

export type SitemapNode = {
  type: "node";
  name: string;
  page?: {
    /** If a page is present this is a folder that is also a page */
    fullPath: string;
  };
  /** If a pattern is present you can add new children to this node */
  pattern?: string;
  /** Means that there is only one child essentially */
  isLinear?: true;
  children: (SitemapNode | PageNode)[];
  moduleFilePath?: ModuleFilePath;
  sourcePath?: SourcePath | ModuleFilePath;
};

// Strictly speaking this should be in the next package but it's shared, because we want to use it in the ui package. We want to resolve that somehow
export function getNextAppRouterSitemapTree(
  srcFolder: string,
  paths: { urlPath: string; moduleFilePath: string }[],
): SitemapNode {
  const root: SitemapNode = {
    type: "node",
    name: "/",
    children: [],
  };

  for (const path of paths) {
    const { urlPath, moduleFilePath: moduleFilePathS } = path;
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (!urlPath.startsWith("/")) {
      console.error(`urlPath must start with /: ${urlPath}`);
      continue;
    }
    const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
    if (urlPath === "/") {
      const fullPath = "/";
      root.pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
      root.page = {
        fullPath,
      };
      root.sourcePath = Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        fullPath as ModulePath,
      );
      root.moduleFilePath = moduleFilePath;
      continue;
    }

    const pathParts = urlPath.split("/").slice(1).filter(Boolean);
    let currentNode: SitemapNode | PageNode = root;

    pathParts.forEach((part, index) => {
      const hasChildren = index < pathParts.length - 1;
      const isLast = index === pathParts.length - 1;
      const fullPath = "/" + pathParts.slice(0, index + 1).join("/");
      const sourcePath = Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        `"${fullPath}"` as ModulePath,
      );
      const node: SitemapNode | PageNode = hasChildren
        ? {
            type: "node",
            name: part,
            pattern,
            moduleFilePath,
            ...(isLast ? { page: { fullPath }, sourcePath } : {}),
            children: [],
          }
        : {
            type: "leaf",
            name: part,
            pattern,
            fullPath,
            moduleFilePath,
            sourcePath,
            children: [],
          };

      const existingNodeIndex = currentNode.children.findIndex(
        (node) => node.name === part,
      );
      if (existingNodeIndex === -1) {
        currentNode.children.push(node);
        if (currentNode.type === "node") {
          currentNode.isLinear = true;
          if (currentNode.children.length > 1) {
            delete currentNode.isLinear;
          }
        }
        currentNode = node;
      } else {
        console.log(
          "existing node",
          currentNode.children[existingNodeIndex],
          path.urlPath,
        );
        const existingNode = currentNode.children[existingNodeIndex];
        if (existingNode.type === "leaf" && hasChildren) {
          const sourcePath = existingNode.sourcePath as SourcePath;
          // convert leaf to node
          currentNode.children[existingNodeIndex] = {
            type: "node",
            name: part,
            pattern,
            page: { fullPath },
            sourcePath,
            children: existingNode.children,
            moduleFilePath,
          };
          currentNode = currentNode.children[existingNodeIndex];
        } else if (existingNode.type === "node" && isLast) {
          // add page, source path and module file path
          existingNode.page = { fullPath };
          existingNode.sourcePath = sourcePath;
          existingNode.moduleFilePath = moduleFilePath;
          existingNode.pattern = pattern;
        } else {
          currentNode = currentNode.children[existingNodeIndex];
        }
      }
    });
  }

  return root;
}

export function getPatternFromModuleFilePath(
  moduleFilePath: string,
  srcFolder: string,
) {
  return (
    moduleFilePath
      .replace(srcFolder, "")
      // TODO: hacky!
      // remove route groups
      .replace(/\/\([^/]+\)/g, "") // not sure we want to do this?
      .replace("/page.val.ts", "")
      .replace("/page.val.js", "")
  );
}
