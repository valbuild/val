"use client";
import { ValConfig } from "@valbuild/core";
import { ValProvider as ReactValProvider } from "@valbuild/react/internal";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
  config: ValConfig;
  disableRefresh?: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  if (pathname.startsWith("/val")) {
    return props.children;
  }
  return (
    <ReactValProvider
      onSubmit={(refreshRequired) => {
        if (refreshRequired && !props.disableRefresh) {
          startTransition(() => {
            router.refresh();
          });
        }
      }}
    >
      {props.children}
    </ReactValProvider>
  );
};
