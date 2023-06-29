import { FC } from "react";
import { ValDashboardGrid } from "./ValDashboardGrid";
import { ValApi } from "@valbuild/react";

interface ValDashboardProps {
  showDashboard: boolean;
  editMode: boolean;
  setShowDashboard: (showDashboard: boolean) => void;
  valApi: ValApi;
}
export const ValDashboard: FC<ValDashboardProps> = ({
  showDashboard,
  editMode,
  valApi,
}) => {
  return (
    <>
      {showDashboard && editMode && (
        <div className="bg-base w-screen fixed z-10 top-[68.54px] text-white overflow-hidden">
          <ValDashboardGrid valApi={valApi} editMode={editMode} />
        </div>
      )}
    </>
  );
};
