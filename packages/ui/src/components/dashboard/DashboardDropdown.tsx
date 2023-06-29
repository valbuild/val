import { SerializedModule } from "@valbuild/core";
import React, { FC, useRef, useState } from "react";
import classNames from "classnames";
import Chevron from "../../assets/icons/Chevron";

interface DashboardDropdownProps {
  selectedModule: SerializedModule;
  setSelectedModule: React.Dispatch<React.SetStateAction<SerializedModule>>;
  modules: SerializedModule[];
}
export const DashboardDropdown: FC<DashboardDropdownProps> = ({
  selectedModule,
  setSelectedModule,
  modules,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={dropdownRef} className="font-serif relative w-full max-w-[300px]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={classNames("w-full")}
      >
        <span className="flex flex-row items-center justify-between w-full">
          <p>
            {selectedModule ? selectedModule.path : "No module selected..."}
          </p>
          <Chevron className={classNames({ "rotate-90": !isOpen })} />
        </span>
      </button>
      <div
        className={classNames(
          { block: isOpen, hidden: !isOpen },
          "absolute right-0 flex flex-col bg-dark-gray z-10"
        )}
      >
        {modules.map((module, idx) => (
          <button
            key={idx}
            className={classNames(
              {
                "bg-light-gray hover:bg-dark-gray ": selectedModule === module,
                "hover:bg-light-gray": selectedModule !== module,
              },
              " w-full px-4 py-4"
            )}
            onClick={() => {
              setSelectedModule(module);
              setIsOpen(false);
            }}
          >
            {module.path}
          </button>
        ))}
      </div>
    </div>
  );
};
