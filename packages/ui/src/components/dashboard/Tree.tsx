import { Children, cloneElement } from "react";
import ImageIcon from "../../assets/icons/ImageIcon";
import Section from "../../assets/icons/Section";
import TextIcon from "../../assets/icons/TextIcon";

type TreeProps = {
  children: React.ReactNode | React.ReactNode[];
  rootPath?: string;
};
export function Tree({ children, rootPath }: TreeProps): React.ReactElement {
  return (
    <div className="val-flex val-flex-col val-bg-warm-black val-text-white val-font-sans val-text-xs val-w-full val-py-2">
      {Children.map(children, (child) => {
        return cloneElement(child as React.ReactElement, {
          paths: [rootPath],
        });
      })}
    </div>
  );
}
type TreeNodeProps = {
  children?: React.ReactNode | React.ReactNode[];
  path: string;
  paths?: string[];
  level?: number;
  type: "string" | "image" | "section";
  setActivePath?: (path: string) => void;
};
Tree.Node = ({
  children,
  paths = [],
  path,
  level = 1,
  type,
  setActivePath,
}: TreeNodeProps): React.ReactElement => {
  const paddingLeft = level * 30;
  const logo =
    type === "string" ? (
      <TextIcon />
    ) : type === "image" ? (
      <ImageIcon className="val-h-[9px] val-w-[9px]" />
    ) : (
      <Section />
    );
  return (
    <div className="val-w-full">
      <button
        className="val-flex val-justify-between val-w-full val-text-white hover:val-bg-dark-gray val-py-2 hover:val-text-warm-black val-text-xs font-[400] val-shrink-0"
        onClick={() => {
          setActivePath && setActivePath(path);
        }}
        style={{ paddingLeft: paddingLeft }}
      >
        <div className="val-flex val-items-center val-justify-center val-gap-2">
          {logo}
          <p>{path}</p>
        </div>
      </button>
      {children && (
        <>
          {Children.map(children, (child) => {
            return cloneElement(child as React.ReactElement, {
              level: level + 1,
              paths: [...paths, path],
            });
          })}
        </>
      )}
    </div>
  );
};
