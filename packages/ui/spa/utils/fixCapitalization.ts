export function fixCapitalization(path: string): string {
  let styledPath = "";
  let lastWasLowerCase = false;
  for (let i = 0; i < path.length; i++) {
    const isUpperCase = path[i] !== path[i].toLowerCase();
    if (i === 0) {
      styledPath += path[i].toUpperCase();
      lastWasLowerCase = false;
    } else if (lastWasLowerCase && isUpperCase) {
      lastWasLowerCase = false;
      styledPath += " " + path[i].toUpperCase();
    } else {
      styledPath += path[i].toLowerCase();
      lastWasLowerCase = true;
    }
  }
  styledPath = styledPath.replace(/[-–—]/g, "");
  return styledPath;
}
