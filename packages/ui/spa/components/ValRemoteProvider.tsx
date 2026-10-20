import { DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import React, { useContext, useEffect, useState } from "react";

type RemoteFiles =
  | {
      status: "ready";
      publicProjectId: string;
      coreVersion: string;
      buckets: string[];
      /**
       * The host a new remote file's ref names, from the project's settings:
       * its own address for a Hosted project whose files are in R2. Absent
       * from a content service that predates it.
       */
      remoteHost?: string;
    }
  | {
      status: "loading" | "not-asked";
    }
  | {
      status: "inactive";
      message: string;
      reason:
        | "unknown-error"
        | "project-not-configured"
        | "api-key-missing"
        | "pat-error"
        | "error-could-not-get-settings"
        | "no-internet-connection"
        | "unauthorized-personal-access-token-error"
        | "unauthorized";
    };

type ValRemoteContextValue = {
  remoteFiles: RemoteFiles;
};

// `null` outside a provider, so a hook that can do without one (useRemoteHost)
// can tell, and one that cannot (useRemoteFiles) still says so.
const ValRemoteContext = React.createContext<ValRemoteContextValue | null>(
  null,
);

function useValRemoteContext(): ValRemoteContextValue {
  const ctx = useContext(ValRemoteContext);
  if (ctx === null) {
    throw new Error("Cannot use ValRemoteContext outside of ValRemoteProvider");
  }
  return ctx;
}

export function ValRemoteProvider({
  children,
  remoteFiles,
}: {
  children: React.ReactNode;
  remoteFiles: RemoteFiles;
}) {
  return (
    <ValRemoteContext.Provider
      value={{
        remoteFiles,
      }}
    >
      {children}
    </ValRemoteContext.Provider>
  );
}

export function useRemoteFiles() {
  const { remoteFiles } = useValRemoteContext();
  return remoteFiles;
}

/**
 * The host a new remote file's ref names. The project's settings say, because
 * they also say where the bytes go -- a Hosted project's are in R2 and served
 * at its own address, and a ref naming another host would point at nothing.
 * `remote.val.build` until they have answered, and outside a provider.
 */
export function useRemoteHost(): string {
  const ctx = useContext(ValRemoteContext);
  const remoteFiles = ctx?.remoteFiles;
  return remoteFiles?.status === "ready" && remoteFiles.remoteHost
    ? remoteFiles.remoteHost
    : DEFAULT_VAL_REMOTE_HOST;
}

export function useCurrentRemoteFileBucket() {
  const { remoteFiles } = useValRemoteContext();
  const [currentBucket, setCurrentBucket] = useState<string | null>(null);

  function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
  }

  useEffect(() => {
    if (
      remoteFiles.status === "ready" &&
      remoteFiles.buckets.length > 0 &&
      currentBucket === null
    ) {
      setCurrentBucket(
        remoteFiles.buckets[getRandomInt(remoteFiles.buckets.length)],
      );
    }
  }, [remoteFiles, currentBucket]);
  return currentBucket;
}
