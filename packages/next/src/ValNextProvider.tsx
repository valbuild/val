"use client";
import { ValProvider as ReactValProvider } from "@valbuild/react/internal";
import { useRouter } from "next/navigation";

export const ValNextProvider = (props: {
  children: React.ReactNode | React.ReactNode[];
}) => {
  const router = useRouter();
  return (
    <ReactValProvider
      onSubmit={(refreshRequired) => {
        if (refreshRequired) {
          router.refresh();
        }
      }}
    >
      {props.children}
    </ReactValProvider>
  );
};
