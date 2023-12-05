export function optimizeTreePath(ids: string[]) {
  return findUpperDirectory(ids);
}

function findUpperDirectory(paths: string[]) {
  if (paths.length === 0) {
    return null;
  }
  let pathSegments = paths[0].split("/");
  for (let i = 1; i < paths.length; i++) {
    const currentPathSegments = paths[i].split("/");
    // Find the minimum length of the two paths
    const minLength = Math.min(pathSegments.length, currentPathSegments.length);

    // Iterate through the segments and find the common prefix
    let commonPrefix = "";
    for (let j = 0; j < minLength; j++) {
      if (pathSegments[j] === currentPathSegments[j]) {
        commonPrefix += pathSegments[j] + "/";
      } else {
        break;
      }
    }
    pathSegments = commonPrefix.split("/").slice(0, -1);

    // If there is no common prefix, return /
    if (pathSegments.length <= 1) {
      return "/";
    }
  }
  const upperDirectory = pathSegments.join("/");
  return upperDirectory;
}
