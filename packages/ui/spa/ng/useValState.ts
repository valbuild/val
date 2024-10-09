import {
  ModuleFilePath,
  SerializedSchema,
  Json,
  SourcePath,
  PatchId,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { useState, useEffect } from "react";
import { Remote } from "../utils/Remote";
import { UpdatingRemote, PatchWithMetadata, ValError } from "./ValProvider";

export function useValState(client: ValClient, statInterval?: number) {
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
  const [stat, setStat] = useState<
    UpdatingRemote<{
      schemaSha: string;
      baseSha: string;
      // TODO:
      // deployments: Record<
      //   ModuleFilePath,
      //   {
      //     status: "deployed" | "deploying" | "failed";
      //     id: string;
      //   }[]
      // >;
      patches: Record<ModuleFilePath, PatchId[]>;
    }>
  >({
    status: "not-asked",
  });

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    const statHandler = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      client("/stat", "POST", {
        body: stat.status === "success" ? stat.data : {},
      })
        .then((res) => {
          if (res.status === 200) {
          } else {
            setStat({
              status: "error",
              error: res.json.message,
            });
          }
        })
        .finally(() => {
          if (statInterval) {
            timeout = setTimeout(statHandler, statInterval);
          }
        });
    };
    statHandler();
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [client, statInterval, stat]);

  useEffect(() => {
    if (schemaSha === null) {
      setSchemas({ status: "loading" });
      client("/schema", "GET", {})
        .then((res) => {
          if (res.status === 200) {
            const sources: Record<ModuleFilePath, UpdatingRemote<Json>> = {};
            const schemas: Record<ModuleFilePath, SerializedSchema> = {};
            setSchemaSha(res.json.schemaSha);
            for (const moduleFilePathS in res.json.schemas) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              const schema = res.json.schemas[moduleFilePath];
              if (schema) {
                schemas[moduleFilePath] = schema;
                sources[moduleFilePath] = { status: "not-asked" }; // reset sources when schema changes
              }
            }
            setSources(sources);
            setSchemas({
              status: "success",
              data: schemas,
            });
          }
        })
        .catch((err) => {
          setSchemas({ status: "error", error: err.message });
        });
    }
  }, [schemaSha]);

  return {
    schemaSha,
    stat,
    schemas,
    sources,
    patchData,
    errors,
  };
}
