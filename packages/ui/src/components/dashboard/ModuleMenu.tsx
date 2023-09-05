import React from "react";

type SourcePath = string; // TODO: replace with import { SourcePath }

export type ModuleMenuProps = {
  children: React.ReactNode[] | React.ReactNode;
};

export function ModuleMenu({ children }: ModuleMenuProps): React.ReactElement {
  return <div>{children}</div>;
}
export type ModuleMenuBranchProps = {
  path: SourcePath;
  children: React.ReactNode[] | React.ReactNode;
  onClick: () => void;
};

ModuleMenu.Branch = ({
  path,
  children,
}: ModuleMenuBranchProps): React.ReactElement => {
  return (
    <div>
      <div>{path}</div>
      <div>{children}</div>
    </div>
  );
};

export type ModuleMenuLeafProps = {
  path: SourcePath;
  children: React.ReactNode;
  onClick: () => void;
};

ModuleMenu.Leaf = ({
  path,
  children,
}: ModuleMenuLeafProps): React.ReactElement => {
  return (
    <div>
      <div>{path}</div>
      <div>{children}</div>
    </div>
  );
};
