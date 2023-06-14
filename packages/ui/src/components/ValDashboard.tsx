import { FC, useEffect, useState } from "react";
import ValDashboardTable from "./ValDashboardTable";
import { SerializedModule } from "@valbuild/lib";
import { ValDashboardGrid } from "./containers/ValDashboardGrid";
import { ValApi } from "@valbuild/react";
import { Inputs } from "../exports";
import {
  RichText,
  FILE_REF_PROP,
  VAL_EXTENSION,
  Internal,
  FileSource,
} from "@valbuild/core";
import { ImageMetadata } from "@valbuild/core/src/schema/image";

interface ValDashboardProps {
  showDashboard: boolean;
  editMode: boolean;
  setShowDashboard: (showDashboard: boolean) => void;
  valApi: ValApi;
}
export const ValDashboard: FC<ValDashboardProps> = ({
  showDashboard,
  editMode,
  setShowDashboard,
  valApi,
}) => {

  return (
    <>
      {showDashboard && editMode && (
        <div className="bg-base w-screen fixed z-10 top-[68.54px] text-white overflow-hidden">
          <ValDashboardGrid
            valApi={valApi}
            editMode={editMode}
          />
        </div>
      )}
    </>
  );
};
