import {
  ModuleFilePath,
  SerializedSchema,
  Json,
  SourcePath,
  PatchId,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { useState, useEffect, useRef } from "react";
import { Remote } from "../utils/Remote";
import { UpdatingRemote, PatchWithMetadata, ValError } from "./ValProvider";
import { z } from "zod";

export function useValState(client: ValClient) {
  const [schemas, setSchemas] = useState<
    Remote<Record<ModuleFilePath, SerializedSchema>>
  >({
    status: "not-asked",
  });
  const [sources, setSources] = useState<
    Record<ModuleFilePath, UpdatingRemote<Json>>
  >({});
  const [requestedSources, setRequestedSources] = useState<ModuleFilePath[]>(
    [],
  );
  const [patchData, setPatchData] = useState<
    Record<PatchId, Remote<PatchWithMetadata>>
  >({});
  const [errors, setErrors] = useState<
    Record<SourcePath, UpdatingRemote<ValError[]>>
  >({});
  const stat = useStat(client);

  return {
    stat,
    schemas,
    sources,
    patchData,
    errors,
  };
}

const PatchId = z.string().refine((p): p is PatchId => true); // TODO: validate
const WSMessage = z.object({
  patches: z.array(PatchId),
});
const StatState = z.object({
  schemaSha: z.string(),
  baseSha: z.string(),
  patches: z.array(PatchId),
});
type StatState = z.infer<typeof StatState>;
function useStat(client: ValClient) {
  // this is where we handle the base state of the application:
  // if the schema or the commit changes, we must reload the schema (and the sources)
  // if base changes, we must fetch sources (with patches applied, and errors)
  // if patches changes, we must fetch sources (applied with patches, and errors) and patch data

  // this happens by calling /stat, then deciding what to do:
  // we always poll /stat every N seconds to get schemaSha and baseSha and potentially a commitSha
  // if we are in dev mode, we get patches using /stat
  // if we are in prod mode, we get patches (and later: deployments) using websocket
  const [requestState, setRequestState] = useState<
    | { type: "init" }
    | {
        type: "request-again";
      }
    | {
        type: "error";
        error: string;
        retry: number;
      }
    | {
        type: "wait";
      }
  >({ type: "init" });
  const [stat, setStat] = useState<UpdatingRemote<StatState>>({
    status: "not-asked",
  });
  const webSocket = useRef<WebSocket | null>(null);

  useEffect(() => {
    client("/stat", "POST", {
      body: null,
    }).then((res) => {
      if (res.status === 200) {
        if (res.json.type === "use-websocket") {
          webSocket.current = new WebSocket(res.json.url);
          webSocket.current.onopen = () => {
            setRequestState({ type: "wait" });
          };
          webSocket.current.onmessage = (event) => {
            const parsedEventData = WSMessage.safeParse(event.data);
            if (parsedEventData.success) {
              setStat((prev) => {
                if (prev.status === "success") {
                  return {
                    status: "success",
                    data: {
                      ...prev.data,
                      patches: parsedEventData.data.patches,
                    },
                  };
                }
                return prev;
              });
            }
          };
        }
      } else {
        setStat({
          status: "error",
          error: res.json.message,
        });
      }
    });
  }, [client]);

  return stat;
}
