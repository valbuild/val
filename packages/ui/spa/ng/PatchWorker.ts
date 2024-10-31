// NOTE: we cannot import anything else than types at top-level (we believe this is a limitation of web workers):
import type { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";
import type { PatchSets } from "./PatchSets";
import type { ValClient } from "@valbuild/shared/internal";

let patchSets: PatchSets | null = null;
let schemas: Partial<Record<ModuleFilePath, SerializedSchema>> | null = null;
let schemaSha: string | null = null;

let host = "/api/val";
let client: ValClient | null = null;
let prevInsertedPatches: Set<string> = new Set();

self.onmessage = async (event) => {
  // Add runtime imports here:
  const { PatchSets } = await import("./PatchSets");
  const { createValClient } = await import("@valbuild/shared/internal");
  //

  const {
    patchIds,
    reset,
    schemaSha: eventSchemaSha,
    host: eventHost,
  } = event.data;
  if (!client) {
    if (eventHost !== host || !client) {
      if (!eventHost) {
        console.error("No host provided");
        throw new Error("No host provided");
      }
      host = eventHost;
      client = createValClient(host);
    }
  }
  if (!patchSets || reset) {
    patchSets = new PatchSets();
    prevInsertedPatches = new Set();
  }
  if (client) {
    if (eventSchemaSha !== schemaSha) {
      patchSets = new PatchSets();
      const schemaRes = await client("/schema", "GET", {
        query: {},
      });
      if (schemaRes.status === 200) {
        schemas = schemaRes.json.schemas;
        schemaSha = schemaRes.json.schemaSha;
        patchSets = new PatchSets();
        prevInsertedPatches = new Set();
      } else {
        console.error("Could not fetch schemas", schemaRes.json.message);
        return;
      }
    }
    if (!schemaSha || !schemas) {
      console.error("No schemas");
      return;
    }
    if (patchIds) {
      if (
        typeof patchIds === "object" &&
        Array.isArray(patchIds) &&
        patchIds.every((id) => typeof id === "string")
      ) {
        const requestPatchIds = [];
        for (const patchId of patchIds) {
          if (!prevInsertedPatches.has(patchId)) {
            requestPatchIds.push(patchId);
          }
        }
        if (patchIds.length > 0 && requestPatchIds.length === 0) {
          return;
        }
        const res = await client("/patches/~", "GET", {
          query: {
            omit_patch: false,
            author: [],
            patch_id:
              patchIds.length === requestPatchIds.length
                ? [] // all patchIds are requested so avoid sending a large request
                : (requestPatchIds as PatchId[]),
            module_file_path: [],
          },
        });
        if (res.status === 200) {
          const patches = res.json.patches;
          for (const [patchIdS, patchMetadata] of Object.entries(patches)) {
            const patchId = patchIdS as PatchId;
            if (patchMetadata) {
              for (const op of patchMetadata.patch || []) {
                const moduleFilePath = patchMetadata.path;
                const schema = schemas[moduleFilePath];
                prevInsertedPatches.add(patchId);
                patchSets.insert(
                  patchMetadata.path,
                  schema,
                  op,
                  patchId,
                  patchMetadata.createdAt,
                  patchMetadata.authorId,
                );
                1;
              }
            }
          }
        }
        postMessage({ patchSet: patchSets.serialize(), schemaSha });
      } else {
        console.error("Invalid patchIds", patchIds);
      }
    }
  } else {
    console.error("Could not create client");
  }
};
