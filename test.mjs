function findUpperDirectory(paths) {
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
    pathSegments = commonPrefix.split("/");

    // If there is no common prefix, return null
    if (pathSegments.length === 0) {
      return null;
    }
  }
  const upperDirectory = pathSegments.join("/");
  return upperDirectory;
}

// Example usage:
const paths = [
  "/home/user/documents",
  "/home/user/pictures",
  "/home/user/html",
];
const upperDirectory = findUpperDirectory(paths);
console.log("Upper Directory:", upperDirectory);
