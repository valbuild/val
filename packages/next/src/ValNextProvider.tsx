"use client";
import { ValProvider as ReactValProvider } from "@valbuild/react/internal";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
}) => {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <ReactValProvider
      onSubmit={(refreshRequired) => {
        if (refreshRequired) {
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
