import { FC, useEffect, useState } from "react";
import { ValCache } from "@valbuild/shared/internal";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { useValState } from "../../ng/useValState";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  ValProvider,
} from "../../ng/ValProvider";
import { Layout } from "../../ng/Layout";

interface ValFullscreenProps {
  client: ValClient;
  cache: ValCache;
}

export const ValStudio: FC<ValFullscreenProps> = ({ client }) => {
  return (
    <ValProvider client={client}>
      <Layout />
    </ValProvider>
  );
};

function FakeStringField({ path }: { path: string }) {
  const sourcePath = path as SourcePath;
  const shallowSourceRes = useShallowSourceAtPath(sourcePath, "string");
  const [patchPath, addPatch] = useAddPatch(sourcePath);
  const schema = useSchemaAtPath(sourcePath);

  if (schema.status !== "success") {
    return (
      <div>
        <pre>{JSON.stringify(schema, null, 2)}</pre>
      </div>
    );
  }
  if (!("data" in shallowSourceRes)) {
    return (
      <div>
        <pre>{JSON.stringify(shallowSourceRes, null, 2)}</pre>
      </div>
    );
  }
  const shallowSource = shallowSourceRes.data;
  return (
    <div>
      <div>Status: {shallowSourceRes.status}</div>
      <input
        className="w-[400px] text-black"
        value={shallowSource || ""}
        onChange={(ev) => {
          const value = ev.target.value;
          addPatch([{ op: "replace", path: patchPath, value }]);
        }}
      />
      <pre>{JSON.stringify(schema, null, 2)}</pre>
    </div>
  );
}

function Tester({ client }: { client: ValClient }) {
  const state = useValState(client);
  useEffect(() => {
    state.requestModule("/content/authors.val.ts");
  }, []);
  if (
    state.stat.status !== "initializing" &&
    state.stat.status !== "not-asked"
  ) {
    return (
      <div className="flex flex-col gap-10">
        <input
          className="w-[400px] text-black"
          disabled={
            state?.sources?.["/content/authors.val.ts"]?.["freekh"]?.name ===
            undefined
          }
          value={
            state?.sources?.["/content/authors.val.ts"]?.["freekh"]?.name || ""
          }
          onChange={(ev) => {
            const value = ev.target.value;
            state.addPatch("/content/authors.val.ts" as ModuleFilePath, [
              {
                op: "replace",
                path: ["freekh", "name"],
                value,
              },
            ]);
          }}
        />
        <div className="grid">
          <div>Status: {state.stat.status}</div>
          <div>Type: {state.stat.data?.type}</div>
          <div>Base sha: {state.stat.data?.baseSha}</div>
          <div>Patch count: {state.stat.data?.patches.length}</div>
        </div>
        <div className="grid">
          <h3>Patches sync</h3>
          <pre>{JSON.stringify(state.patchesStatus, null, 2)}</pre>
        </div>
        <div className="grid">
          <h3>Sources sync</h3>
          <pre>{JSON.stringify(state.sourcesSyncStatus, null, 2)}</pre>
        </div>
        <pre>{JSON.stringify(state.sources, null, 2)}</pre>
      </div>
    );
  }
  return <pre>{JSON.stringify(state.stat, null, 2)}</pre>;
}
