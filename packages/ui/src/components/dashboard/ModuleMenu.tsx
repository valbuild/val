import { SerializedSchema } from "@valbuild/core";
import { ChevronDown, ChevronUp } from "react-feather";
import React from "react";
import classNames from "classnames";

export type ModuleMenuProps = {
  children: React.ReactNode[] | React.ReactNode;
};

// TODO: move out of this file
export type JsonPath = string;

export function ModuleMenu({ children }: ModuleMenuProps): React.ReactElement {
  return (
    <div className="p-4 border divide-y bg-base text-primary divide-border border-border">
      {children}
    </div>
  );
}
export type ModuleMenuBranchProps = {
  name: string;
  icon: React.ReactNode;
  path: JsonPath;
  selected: boolean;
  children: React.ReactNode[] | React.ReactNode;
  onSelect: (path: JsonPath) => void;
};

ModuleMenu.Branch = ({
  name,
  icon,
  path,
  selected,
  children,
  onSelect,
}: ModuleMenuBranchProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="divide-y divide-border">
      <div className="flex items-center py-2 gap-x-1">
        <span
          className="cursor-pointer"
          onClick={() => {
            setOpen((prev) => !prev);
          }}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
        </span>
        <span
          className={classNames("cursor-pointer flex items-center gap-x-2", {
            "text-highlight": selected,
          })}
          onClick={() => {
            setOpen(true);
            onSelect(path);
          }}
        >
          <span>{name}</span>
          <span>{icon}</span>
        </span>
      </div>
      {open && (
        <div className="px-2 border-l divide-y divide-border border-border">
          {children}
        </div>
      )}
    </div>
  );
};

export type ModuleMenuLeafProps = {
  children: React.ReactNode;
  icon: React.ReactNode;
  selected: boolean;
  path: JsonPath;
  onSelect: (path: JsonPath) => void;
};

ModuleMenu.Leaf = ({
  selected,
  icon,
  children,
  path,
  onSelect,
}: ModuleMenuLeafProps): React.ReactElement => {
  return (
    <div
      className={classNames("cursor-pointer flex items-center gap-x-2 py-2", {
        "text-highlight": selected,
      })}
      onClick={() => {
        onSelect(path);
      }}
    >
      <span>{children}</span>
      <span>{icon}</span>
    </div>
  );
};
