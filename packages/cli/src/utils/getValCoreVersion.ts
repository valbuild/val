import { getVersions } from "../getVersions";

export function getValCoreVersion() {
  return getVersions().coreVersion || "unknown";
}
