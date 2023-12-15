import { Fragment } from "react";

export function Path({ children }: { children: string }) {
  const segs = children.split("/").filter((seg) => seg);
  return segs.map((seg, i) => {
    if (i !== segs.length - 1) {
      return (
        <Fragment key={`${children}/${seg}`}>
          <span>{seg}</span>
          <span className="px-[2px] text-muted">{"/"}</span>
        </Fragment>
      );
    }
    return <Seg key={children}>{seg}</Seg>;
  });
}

function Seg({ children: children }: { children: string }) {
  if (children.includes(".")) {
    const segs = children.split(".");
    return segs.map((seg, i) => {
      if (i !== segs.length - 1) {
        return (
          <Fragment key={`${children}.${seg}`}>
            <span>{i === 0 ? seg : JSON.parse(seg)}</span>
            <span className="px-[2px] text-muted">{"."}</span>
          </Fragment>
        );
      }
      return <span key={children}>{i === 0 ? seg : JSON.parse(seg)}</span>;
    });
  }
  return <span>{children}</span>;
}
