import {
  Internal,
  Json,
  ModuleId,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { useEffect, useState } from "react";
import { z } from "zod";

type Mode = "windows" | "dashboard";
export type ValOverlayProps = { defaultMode?: Mode };

export function ValOverlay({ defaultMode }: ValOverlayProps) {
  const [mode, setMode] = useState(defaultMode || "dashboard");

  if (mode === "windows") {
    return <ValWindowsOverlay />;
  } else if (mode === "dashboard") {
    return <ValDashboardOverlay />;
  }
  return null;
}

function ValWindowsOverlay() {
  return <div>TODO</div>;
}

function ValDashboardOverlay() {
  const rootModules = useValInitState();

  return (
    <div className="fixed top-0 left-0 w-full h-screen bg-base">
      <div>{rootModules.map()}</div>
    </div>
  );
}

const ValRes = z.object({
  data: z.record(
    z.object({
      schema: z.record(z.any()),
      source: z.record(z.any()),
      patches: z.record(z.any()),
    })
  ),
  git: z.object({
    commit: z.string(),
    branch: z.string(),
  }),
});

function useValInitState() {
  const orgName = "freekh";
  const branch = "test-repo";
  const path: string | undefined = undefined;
  const gitRef = "heads/main";
  const url = `/v1/tree/${orgName}/${branch}/${gitRef}${
    path ? `/~${path}` : ""
  }`;
  const proxyUrl = new URL(`/api/val/proxy${url}`, "http://localhost:3000");
  proxyUrl.searchParams.set("schema", true.toString());
  useEffect(() => {
    fetch(proxyUrl).then(async (res) => {
      console.log(await res.json());
    });
  });
}

function useValModuleFromPath(commitSha: string, sourcePath: SourcePath) {
  // TODO: we can optimize here by only fetching the part we need
  const [moduleId, modulePath] =
    Internal.splitModuleIdAndModulePath(sourcePath);
  const orgName = "freekh";
  const branch = "test-repo";
  const path: string | undefined = moduleId;
  const gitRef = "heads/main";
  const url = `/v1/tree/${orgName}/${branch}/${gitRef}${
    path ? `/~${path}` : ""
  }`;
  const proxyUrl = new URL(`/api/val/proxy${url}`, "http://localhost:3000");
  proxyUrl.searchParams.set("schema", true.toString());
  proxyUrl.searchParams.set("source", true.toString());
  proxyUrl.searchParams.set("commit", commitSha);
  proxyUrl.searchParams.set("patch", true.toString());

  useEffect(() => {
    fetch(proxyUrl).then(async (res) => {
      const { data, git } = (await res.json()) as {
        // TODO: validate
        data: Record<
          ModuleId,
          {
            schema: SerializedSchema;
            source: Json;
            patches: { applied: string[]; failed: string[] };
          }
        >;
        git: { commit: string; branch: string };
      };

      const a = Internal.resolvePath(
        modulePath,
        data[moduleId].source,
        data[moduleId].schema
      );
      console.log(a);
      console.log(data, git);
    });
  });
}
