// import { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";
import { type PatchSets } from "./PatchSets";
import type { ValClient } from "@valbuild/shared/internal";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let patchSets: PatchSets | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const client: ValClient | null = null;

self.onmessage = async (event) => {
  try {
    patchSets = new (await import("./PatchSets")).PatchSets();
    patchSets.reset();
    console.log("->", patchSets.serialize());
  } catch (e) {
    console.error(e);
  }
  console.log("Worker received message", event.data);
};
