import { SerializedModule } from "@valbuild/core";
import classNames from "classnames";
import { Dispatch, FC, SetStateAction } from "react";

interface ValTreeNavigator {
  modules: SerializedModule[];
  selectedModule?: SerializedModule;
  setSelectedModule: Dispatch<SetStateAction<SerializedModule>>;
  selectedSubmodule?: string;
  setSelectedSubmodule: Dispatch<SetStateAction<string>>;
}
const ValTreeNavigator: FC<ValTreeNavigator> = ({
  modules,
  selectedModule,
  setSelectedModule,
  selectedSubmodule,
  setSelectedSubmodule,
}) => {
  return (
    <div className={classNames("flex flex-col gap-4 font-serif text-lg")}>
      {modules.map((module, idx) => (
        <div key={idx}>
          <button
            onClick={() => {
              setSelectedModule(module);
              setSelectedSubmodule("");
            }}
          >
            <h1
              className={classNames(
                "text-xl",
                { "hover:font-extrabold": selectedModule !== module },
                {
                  "font-extrabold hover:underline": selectedModule === module,
                }
              )}
            >
              {module.path}
            </h1>
          </button>
          <div className="flex flex-col justify-start items-start gap-2">
            {module.source?.map((source, key) => (
              <div className="ml-4" key={key}>
                <button
                  className={classNames("flex text-left", {
                    "underline": selectedSubmodule === source.title,
                  })}
                  onClick={() => {
                    setSelectedSubmodule(source.title);
                    if (selectedModule !== module) {
                      setSelectedModule(module);
                    }
                  }}
                >
                  {source.title}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ValTreeNavigator;
