import { useState, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

function ShadowContent({
  root,
  children,
}: {
  children: React.ReactNode;
  root: Element | DocumentFragment;
}) {
  return createPortal(children, root);
}

export const ShadowRoot = ({ children }: { children: React.ReactNode }) => {
  const node = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    if (node.current) {
      const root = node.current.attachShadow({
        mode: "closed",
      });
      setRoot(root);
    }
  }, []);

  return (
    <div ref={node}>
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
};
