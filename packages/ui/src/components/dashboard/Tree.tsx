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
    <div className="flex flex-col bg-warm-black text-white font-sans text-xs w-full py-2">
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
  type: "text" | "image" | "section";
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
    type === "text" ? (
      <TextIcon />
    ) : type === "image" ? (
      <ImageIcon className="h-[9px] w-[9px]" />
    ) : (
      <Section />
    );
  return (
    <div className="w-full h-full">
      <button
        className="flex justify-between w-full h-full text-white hover:bg-dark-gray group py-2 hover:text-warm-black text-xs font-[400]"
        onClick={() => {
          setActivePath && setActivePath(path);
        }}
        style={{ paddingLeft: paddingLeft }}
      >
        <div className="flex items-center justify-center gap-2">
          {logo}
          {path}
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
