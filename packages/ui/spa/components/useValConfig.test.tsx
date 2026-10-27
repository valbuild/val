/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import { DEFAULT_VAL_REMOTE_HOST, type ValConfig } from "@valbuild/core";
import React from "react";
import { useValConfig, ValFieldProvider } from "./ValFieldProvider";
import { ValRemoteProvider } from "./ValRemoteProvider";

const config: ValConfig = {};
const HOSTED = "https://www.acme.no/_val";

type RemoteFiles = React.ComponentProps<
  typeof ValRemoteProvider
>["remoteFiles"];

/** Records the remote host the config held on every render. */
function Recorder({ seen }: { seen: string[] }) {
  const studioConfig = useValConfig();
  seen.push(studioConfig?.remoteHost ?? "no config");
  return null;
}

function Studio({
  remoteFiles,
  seen,
}: {
  remoteFiles: RemoteFiles;
  seen: string[];
}) {
  return (
    <ValRemoteProvider remoteFiles={remoteFiles}>
      <ValFieldProvider
        config={config}
        getDirectFileUploadSettings={async () => ({
          status: "error",
          error: "not used",
        })}
      >
        <Recorder seen={seen} />
      </ValFieldProvider>
    </ValRemoteProvider>
  );
}

describe("useValConfig", () => {
  // A field rendered when the settings arrive builds its upload with this
  // config. If that render still says remote.val.build, its first upload
  // names a host that does not serve a Hosted project's files.
  test("names the settings' remote host on the render they arrive in", () => {
    const seen: string[] = [];
    const { rerender } = render(
      <Studio remoteFiles={{ status: "loading" }} seen={seen} />,
    );
    expect(seen.at(-1)).toBe(DEFAULT_VAL_REMOTE_HOST);
    const before = seen.length;

    rerender(
      <Studio
        remoteFiles={{
          status: "ready",
          publicProjectId: "3f9a2c1",
          coreVersion: "0.146.3",
          buckets: ["r2"],
          remoteHost: HOSTED,
        }}
        seen={seen}
      />,
    );

    expect(seen.slice(before)).toEqual(seen.slice(before).map(() => HOSTED));
    expect(seen.length).toBeGreaterThan(before);
  });

  test("keeps the same object while nothing it is made of changes", () => {
    const configs: unknown[] = [];
    function Keep(_: { tick: number }) {
      configs.push(useValConfig());
      return null;
    }
    const tree = (tick: number) => (
      <ValRemoteProvider remoteFiles={{ status: "loading" }}>
        <ValFieldProvider
          config={config}
          getDirectFileUploadSettings={async () => ({
            status: "error",
            error: "not used",
          })}
        >
          <Keep tick={tick} />
        </ValFieldProvider>
      </ValRemoteProvider>
    );
    const { rerender } = render(tree(0));
    rerender(tree(1));
    expect(configs.length).toBeGreaterThan(1);
    expect(new Set(configs).size).toBe(1);
  });
});
