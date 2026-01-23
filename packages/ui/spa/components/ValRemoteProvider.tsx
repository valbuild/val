import React, { useContext, useEffect, useState } from "react";

type RemoteFiles =
  | {
      status: "ready";
      publicProjectId: string;
      coreVersion: string;
      buckets: string[];
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

const ValRemoteContext = React.createContext<ValRemoteContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValRemoteContext outside of ValRemoteProvider"
        );
      },
    }
  ) as ValRemoteContextValue
);

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
  const { remoteFiles } = useContext(ValRemoteContext);
  return remoteFiles;
}

export function useCurrentRemoteFileBucket() {
  const { remoteFiles } = useContext(ValRemoteContext);
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
        remoteFiles.buckets[getRandomInt(remoteFiles.buckets.length)]
      );
    }
  }, [remoteFiles, currentBucket]);
  return currentBucket;
}
