import { createContext, useContext, ReactNode } from "react";
import { ValConfig } from "@valbuild/core";

interface ValConfigContextProps {
  config: ValConfig;
}

const ValConfigContext = createContext<ValConfigContextProps>({
  config: {} as ValConfig,
});

interface ValConfigProviderProps {
  config: ValConfig;
  children: ReactNode | ReactNode[];
}

const ValConfigProvider = ({ config, children }: ValConfigProviderProps) => {
  return (
    <ValConfigContext.Provider value={{ config }}>
      {children}
    </ValConfigContext.Provider>
  );
};

const useValConfig = (): ValConfigContextProps => {
  const context = useContext(ValConfigContext);
  if (context === undefined) {
    throw new Error("useValConfig must be used within a ValConfigProvider");
  }
  return context;
};

export { ValConfigProvider, useValConfig };
