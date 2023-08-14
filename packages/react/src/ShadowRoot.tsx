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
      if (node.current.shadowRoot) {
        setRoot(node.current.shadowRoot);
      } else {
        const root = node.current.attachShadow({
          mode: "open",
        });
        setRoot(root);
      }
    }
  }, []);

  return (
    <div ref={node}>
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
};
