import pc from "picocolors";
import { checkBuildTools as check } from "./publish/buildArtifacts";

/**
 * `val check-build-tools` -- a thin shell around `checkBuildTools`: says
 * whether `val publish` could build here, and fails when it could not.
 */
export async function checkBuildTools(): Promise<void> {
  const checked = await check();
  if (checked.status === "error") {
    console.error(pc.red(checked.message));
    process.exitCode = 1;
    return;
  }
  console.log("val publish can build here.");
}
