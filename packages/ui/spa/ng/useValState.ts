import {
  ModuleFilePath,
  SerializedSchema,
  Json,
  SourcePath,
  PatchId,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import React, {
  useState,
  useEffect,
  useRef,
  SetStateAction,
  Dispatch,
} from "react";
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
const StatData = z.object({
  schemaSha: z.string(),
  baseSha: z.string(),
  patches: z.array(PatchId),
});
type StatData = z.infer<typeof StatData>;

type StatState =
  | {
      status: "not-asked";
    }
  | {
      status: "initializing";
    }
  | {
      status: "updated-request-again";
      data: StatData;
      wait: number;
    }
  | {
      status: "updating";
      data: StatData;
    }
  | {
      status: "ws-message-received";
      data: StatData;
    }
  | {
      status: "error";
      data?: StatData;
      error: string;
      retries: number;
      wait: number;
    };
function useStat(client: ValClient) {
  // this is where we handle the base state of the application:
  // if the schema or the commit changes, we must reload the schema (and the sources)
  // if base changes, we must fetch sources (with patches applied, and errors)
  // if patches changes, we must fetch sources (applied with patches, and errors) and patch data

  // the base state changes by calling /stat, then deciding what to do:
  // if we are in dev mode, the /stat end point will block until there is a change so we immediately call /stat again on completion
  // if we are in prod mode, the /stat end point returns immediately with the base state, but we also get a websocket url to listen to patches

  const [stat, setStat] = useState<StatState>({
    status: "not-asked",
  });

  const webSocketRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (stat.status === "updated-request-again" || stat.status === "error") {
      if (stat.wait === 0) {
        execStat(client, webSocketRef, stat, setStat);
      } else {
        const timeout = setTimeout(() => {
          execStat(client, webSocketRef, stat, setStat);
        }, stat.wait);
        return () => clearTimeout(timeout);
      }
    }
  }, [client, stat]);
  useEffect(() => {
    setStat({
      status: "initializing",
    });
    execStat(client, webSocketRef, stat, setStat);
  }, [client]);

  return stat;
}

const WebSocketStatInterval = 10 * 1000;

function execStat(
  client: ValClient,
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  stat: StatState,
  setStat: Dispatch<SetStateAction<StatState>>,
) {
  let body = null;
  if ("data" in stat && stat.data) {
    body = {
      schemaSha: stat.data.schemaSha,
      baseSha: stat.data.baseSha,
      patches: stat.data.patches,
    };
  }

  return client("/stat", "POST", {
    body: body,
  })
    .then((res) => {
      if (res.status === 200) {
        if (
          res.json.type === "did-change" ||
          res.json.type === "no-change" ||
          res.json.type === "request-again"
        ) {
          setStat({
            status: "updated-request-again",
            data: res.json,
            wait: webSocketRef.current ? WebSocketStatInterval : 0, // why 0 wait? If websocket is not used, we are long polling so no point in waiting
          });
        } else if (res.json.type === "use-websocket") {
          if (webSocketRef.current) {
            webSocketRef.current.close();
          }
          webSocketRef.current = new WebSocket(res.json.url);
          webSocketRef.current.onmessage = (event) => {
            const message = WSMessage.parse(JSON.parse(event.data));
            setStat((prev) => {
              if ("data" in prev && prev.data) {
                return {
                  status: "ws-message-received",
                  data: {
                    ...prev.data,
                    patches: message.patches,
                  },
                };
              }
              return prev;
            });
          };
          webSocketRef.current.onclose = () => {
            webSocketRef.current = null;
          };
          webSocketRef.current.onerror = () => {
            setStat((prev) => createError(prev, "WebSocket error"));
          };
          setStat({
            status: "updated-request-again",
            data: res.json,
            wait: WebSocketStatInterval,
          });
        }
      } else {
        setStat((prev) => createError(prev, res.json.message));
      }
    })
    .catch((err) => {
      setStat((prev) => createError(prev, err.message));
    });
}

function createError(stat: StatState, message: string): StatState {
  const retries = "retries" in stat ? stat.retries : 0;
  // a bit of random jitter in the start, but maxes out pretty soon on 5000ms
  const waitMillis =
    stat.status === "error" && stat.retries > 1
      ? Math.min(500, stat.retries * 50 + Math.floor(Math.random() * 100)) * 10
      : 0;

  return {
    status: "error",
    error: message,
    data: "data" in stat ? stat.data : undefined,
    retries,
    wait: waitMillis,
  };
}
