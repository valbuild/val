import { SerializedModule } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import classNames from "classnames";
import React, { useState, FC, ReactNode, useEffect } from "react";
import { ValDashboardEditor } from "./ValDashboardEditor";
import { ValTreeNavigator } from "./ValTreeNavigator";

interface PanelProps {
  header?: ReactNode;
  width?: number;
  onResize?: (width: number) => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapse?: () => void;
  children: ReactNode;
}

const Panel: FC<PanelProps> = ({
  header,
  width,
  onResize,
  collapsible,
  collapsed,
  onCollapse,
  children,
}) => {
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onResize) return;

    e.preventDefault();
    const initialX = e.clientX;
    const initialWidth = width || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = initialWidth + moveEvent.clientX - initialX;
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };
  return (
    <>
      {!collapsed ? (
        <div
          className={classNames(
            "relative border border-dark-gray min-w-0 h-full overflow-auto",
            {
              "flex-grow": !width,
            }
          )}
          style={width ? { width: `${width}px` } : {}}
        >
          {onResize && (
            <div
              className="absolute inset-y-0 right-0 cursor-col-resize w-[1px] bg-dark-gray hover:w-[2px] hover:bg-light-gray"
              onMouseDown={handleMouseDown}
            />
          )}
          <div className="bg-gray-300 border border-dark-gray flex justify-between items-center h-[75px] w-full font-serif px-4">
            {header}
            {collapsible && (
              <button
                onClick={onCollapse}
                className="px-2 py-1 font-bold text-white bg-red-500 rounded hover:bg-red-700"
              >
                {collapsed ? "Expand" : "Collapse"}
              </button>
            )}
          </div>
          <div>{children}</div>
        </div>
      ) : (
        <button
          onClick={onCollapse}
          className="absolute inset-y-0 right-[16px] w-fit  flex items-center justify-end"
        >
          open panel again
        </button>
      )}
    </>
  );
};

interface ValDashboardGridProps {
  valApi: ValApi;
  editMode: boolean;
}

export const ValDashboardGrid: FC<ValDashboardGridProps> = ({
  valApi,
  editMode,
}) => {
  const [widths, setWidths] = useState([300, (2 * window.innerWidth) / 3]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [modules, setModules] = useState<SerializedModule[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  useEffect(() => {
    // valApi.getTree({}).then((modules) => {
    //   setModules(modules);
    // });
  }, [editMode]);

  const handleResize = (index: number) => (width: number) => {
    setWidths((prevWidths) => {
      const newWidths = [...prevWidths];
      newWidths[index] = Math.max(width, 300);
      return newWidths;
    });
  };

  return (
    <div className="flex justify-start h-screen">
      <Panel width={widths[0]} onResize={handleResize(0)}>
        <ValTreeNavigator
          modules={modules}
          selectedModule={selectedPath}
          setSelectedModule={setSelectedPath}
          valApi={valApi}
        />
      </Panel>
      <Panel
        header={
          selectedPath && (
            <div className="w-full max-w-[1000px] bg-dark-gray px-4 py-2 rounded-lg">
              {selectedPath}
            </div>
          )
        }
        width={widths[1]}
        onResize={handleResize(1)}
      >
        <ValDashboardEditor selectedPath={selectedPath} valApi={valApi} />
      </Panel>
    </div>
  );
};
