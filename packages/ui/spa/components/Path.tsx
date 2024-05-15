import { Internal } from "@valbuild/core";
import { Fragment } from "react";

export function Path({ children }: { children: string }) {
  const [moduleFilePathSegs, modulePathSegs] = children.split(
    Internal.ModuleFilePathSep
  );
  const segs = moduleFilePathSegs.split("/").filter((seg) => seg);
  return segs
    .map((seg) => {
      return (
        <Fragment key={`${children}/${seg}`}>
          <span>{seg}</span>
          <span className="px-[2px] text-muted">{"/"}</span>
        </Fragment>
      );
    })
    .concat(
      ...(modulePathSegs
        ? [<Seg key={modulePathSegs}>{modulePathSegs}</Seg>]
        : [])
    );
}

function Seg({ children: children }: { children: string }) {
  try {
    if (children.includes(".")) {
      const segs = children.split(".");
      return segs.map((seg, i) => {
        if (i !== segs.length - 1) {
          return (
            <Fragment key={`${children}.${seg}`}>
              <span>{JSON.parse(seg)}</span>
              <span className="text-muted">{"."}</span>
            </Fragment>
          );
        }

        return <span key={children}>{JSON.parse(seg)}</span>;
      });
    }
    return <span>{children}</span>;
  } catch (e) {
    console.error("Parser failure", { children }, e);
    throw new Error("Unexpected path formatting failure");
  }
}
