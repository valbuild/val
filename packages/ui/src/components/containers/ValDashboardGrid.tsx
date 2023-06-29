import { SerializedModule } from "@valbuild/core";
import { ValApi } from "@valbuild/react";
import classNames from "classnames";
import React, {
  useState,
  useRef,
  FC,
  ReactNode,
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
} from "react";
import DashboardDropdown from "../DashboardDropdown";
import { Inputs } from "../forms/Form";
import ValDashboardEditor from "../ValDashboardEditor";
import ValTreeNavigator from "../ValTreeNavigator";

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
    const initialWidth = width!;

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
          <div className="bg-gray-300 border-b border-dark-gray flex justify-between items-center h-[75px] w-full font-serif px-4">
            {header}
            {collapsible && (
              <button
                onClick={onCollapse}
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
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
  const [widths, setWidths] = useState([
    300,
    (2 * window.innerWidth) / 3,
  ]);
  const [collapsed, setCollapsed] = useState(false);
  const [modules, setModules] = useState<SerializedModule[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  useEffect(() => {
    valApi.getAllModules().then((modules) => {
      setModules(modules);
    });
  }, [editMode]);

  const handleResize = (index: number) => (width: number) => {
    setWidths((prevWidths) => {
      const newWidths = [...prevWidths];
      newWidths[index] = Math.max(width, 300);
      return newWidths;
    });
  };

  const handleCollapse = useCallback(() => {
    setCollapsed(!collapsed);
    if (!collapsed) {
      setWidths((prevWidths) => {
        const newWidths = [...prevWidths];
        newWidths[1] = window.innerWidth - newWidths[0];
        return newWidths;
      });
    } else {
      setWidths([window.innerWidth / 6, (2 * window.innerWidth) / 3]);
    }
  }, [collapsed]);

  return (
    <div className="flex h-screen justify-start">
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
      {/* <Panel
        header={<div>labbalooey</div>}
        collapsible
        collapsed={collapsed}
        onCollapse={handleCollapse}
      >
        Width: 'auto'
      </Panel> */}
    </div>
  );
};
