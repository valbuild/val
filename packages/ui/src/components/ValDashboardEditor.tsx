import {
  SerializedModule
} from "@valbuild/core";
import { JsonArray } from "@valbuild/core/src/Json";
import { ValApi } from "@valbuild/react";
import { FC } from "react";
import SourceCollapsible from "./SourceCollapsible";

interface ValDashboardEditorProps {
  selectedModule: SerializedModule;
  selectedSubmodule: string;
  valApi: ValApi;
}

const ValDashboardEditor: FC<ValDashboardEditorProps> = ({
  selectedModule,
  selectedSubmodule,
  valApi,
}) => {
  return selectedModule ? (
    <div className="flex flex-col items-start">
      {(selectedModule?.source as JsonArray)?.map((source, idx) => (
        <SourceCollapsible
          source={source}
          key={`${selectedModule.path}/${idx}`}
          idx={idx}
          schema={selectedModule.schema}
          valApi={valApi}
          path={selectedModule.path}
          selectedSubmodule={selectedSubmodule}
        />
      ))}
    </div>
  ) : (
    <div>
      <h1>Nothing selected</h1>
    </div>
  );
};

export default ValDashboardEditor;
