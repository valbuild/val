import {
  ArrowDownUp,
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Languages,
  ListFilter,
  Plus,
  Tally2,
} from "lucide-react";
import { Button, ButtonProps } from "../components/ui/button";
import classNames from "classnames";
import React, { useContext, useEffect, useState } from "react";
import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import fakeModules from "./fakeContent/val.modules";
import { Remote } from "../utils/Remote";
import { StringField } from "../components/fields/primitives/StringField";
import { UnexpectedSourceType } from "../components/fields/UnexpectedSourceType";
import { NumberField } from "../components/fields/primitives/NumberField";
import { BooleanField } from "../components/fields/primitives/BooleanField";

const UIContext = React.createContext<{
  getSchemasByModuleFilePath: () => Promise<
    Record<ModuleFilePath, SerializedSchema>
  >;
  getSourceContent: (moduleFilePath: ModuleFilePath) => Promise<Json>;
  currentSourcePath: SourcePath | ModuleFilePath | null;
  navigate: (path: SourcePath | ModuleFilePath) => void;
}>({
  getSchemasByModuleFilePath: (): never => {
    throw new Error("UIContext not provided");
  },
  getSourceContent: (): never => {
    throw new Error("UIContext not provided");
  },
  currentSourcePath: null,
  navigate: () => {
    throw new Error("UIContext not provided");
  },
});

async function getFakeModuleDefs() {
  const moduleDefs = await Promise.all(
    fakeModules.modules.map(async (module) => {
      module.def().then(console.log);
      return module.def().then((module) => module.default);
    })
  );

  return moduleDefs;
}

function UIProvider({ children }: { children: React.ReactNode }) {
  const [currentSourcePath, setSourcePath] = useState<
    SourcePath | ModuleFilePath | null
  >("/content/basic.val.ts" as SourcePath); // TODO: just testing out /content/basic.val.ts for now
  return (
    <UIContext.Provider
      value={{
        currentSourcePath,
        navigate: setSourcePath,
        getSourceContent: async (
          moduleFilePath: ModuleFilePath
        ): Promise<Json> => {
          const moduleDefs = await getFakeModuleDefs();

          const moduleDef = moduleDefs.find((module) => {
            const path = Internal.getValPath(module);
            return path === (moduleFilePath as unknown as SourcePath);
          });

          if (!moduleDef) {
            throw new Error("Module not found");
          }
          return Internal.getSource(moduleDef) as Json;
        },
        getSchemasByModuleFilePath: async () => {
          const moduleDefs = await getFakeModuleDefs();
          const schemaByModuleFilePath: Record<
            ModuleFilePath,
            SerializedSchema
          > = {};
          for (const module of moduleDefs) {
            const schema = Internal.getSchema(module);
            const path = Internal.getValPath(module);
            if (!path) {
              throw new Error("No path found for module");
            }
            if (!schema) {
              throw new Error("No schema found for module: " + path);
            }
            schemaByModuleFilePath[path as unknown as ModuleFilePath] =
              schema.serialize();
          }
          return schemaByModuleFilePath;
        },
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

function useSchemas(): Remote<Record<ModuleFilePath, SerializedSchema>> {
  const { getSchemasByModuleFilePath } = useContext(UIContext);
  const [schemas, setSchemas] = useState<
    Remote<Record<ModuleFilePath, SerializedSchema>>
  >({
    status: "not-asked",
  });

  useEffect(() => {
    getSchemasByModuleFilePath()
      .then((schemas) => {
        setSchemas({ status: "success", data: schemas });
      })
      .catch((err: Error) => {
        setSchemas({ status: "error", error: err.message });
      });
  }, [getSchemasByModuleFilePath]);

  return schemas;
}

function useNavigation() {
  const { navigate, currentSourcePath } = useContext(UIContext);
  return {
    navigate,
    currentSourcePath,
  };
}

function useModuleSource(moduleFilePath: ModuleFilePath | null): Remote<Json> {
  const { getSourceContent } = useContext(UIContext);
  const [sourceContent, setSourceContent] = useState<Remote<Json>>({
    status: "not-asked",
  });

  useEffect(() => {
    if (!moduleFilePath) {
      setSourceContent({ status: "success", data: null });
      return;
    }
    getSourceContent(moduleFilePath)
      .then((content) => {
        setSourceContent({ status: "success", data: content });
      })
      .catch((err: Error) => {
        setSourceContent({ status: "error", error: err.message });
      });
  }, [sourceContent, getSourceContent]);

  return sourceContent;
}

export function Layout() {
  return (
    <UIProvider>
      <div className="absolute top-0 left-0 w-full h-screen">
        <main className="grid grid-cols-[284px_auto_284px] grid-rows-[64px_auto] h-full py-4">
          <HeaderLeft />
          <HeaderCenter />
          <HeaderRight />
          <Left />
          <Center />
          <Right />
        </main>
        <LayoutBackground />
      </div>
    </UIProvider>
  );
}

function HeaderLeft() {
  return (
    <div className="flex items-center h-12 gap-4 px-5 pt-4">
      <div>
        <FakeIcon />
      </div>
      <List />
    </div>
  );
}

function Left() {
  return (
    <div className="flex flex-col justify-between px-5">
      <nav className="max-h-full overflow-scroll">
        <Divider />
        <Members />
        <Divider />
        <NavContentExplorer title="Content" />
        <Divider />
        <NavSiteMap
          title="Blank website"
          items={["Projects", "Benefits", "Darkside", "Salary", "Working"]}
        />
        <Divider />
      </nav>
      <Author size="lg" />
    </div>
  );
}

function NavContentExplorer({ title }: { title: string }) {
  const remoteSchemasByModuleFilePath = useSchemas();
  const { navigate } = useNavigation();
  if (remoteSchemasByModuleFilePath.status === "error") {
    throw new Error(remoteSchemasByModuleFilePath.error);
  }
  if (remoteSchemasByModuleFilePath.status !== "success") {
    return <Loading />;
  }

  return (
    <div className="px-2">
      <div className="py-2">{title}</div>
      <div>
        {Object.keys(remoteSchemasByModuleFilePath.data).map(
          (moduleFilePath) => (
            <button
              className="flex justify-between p-2"
              key={moduleFilePath}
              onClick={() => {
                navigate(moduleFilePath as SourcePath);
              }}
            >
              <span className="flex items-center text-sm">
                <Tally2 />
                <span>{moduleFilePath}</span>
              </span>
              <ChevronRight />
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Loading() {
  return null;
}

function NavSiteMap({ items, title }: { title: string; items: string[] }) {
  return (
    <div className="px-2">
      <div className="py-2">{title}</div>
      <div>
        {items.map((item, i) => (
          <div className="flex justify-between p-2" key={i}>
            <span className="flex items-center text-sm">
              <Tally2 />
              <span>{item}</span>
            </span>
            <ChevronRight />
          </div>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-full pt-4 mb-4 border-b border-border" />;
}

function Author({ size }: { size: "md" | "lg" }) {
  return (
    <img
      src="https://randomuser.me/api/portraits/women/75.jpg"
      className={classNames("rounded-full", {
        "w-8 h-8": size === "md",
        "w-10 h-10": size === "lg",
      })}
    />
  );
}

function Members() {
  return (
    <div className="flex items-center gap-2 p-2 bg-primary-foreground w-fit rounded-3xl">
      <Author size="md" />
      <img
        src="https://randomuser.me/api/portraits/women/71.jpg"
        className="w-8 h-8 rounded-full"
      />
      <div className="w-8 h-8 text-xs leading-8 text-center rounded-full bg-secondary text-secondary-foreground">
        +10
      </div>
      <ChevronDown />
    </div>
  );
}

function List() {
  return (
    <Button
      className="flex items-center justify-between w-full rounded-3xl bg-primary-foreground border-primary-foreground"
      variant="outline"
    >
      <span>Blank Oslo</span>
      <ChevronsUpDown size={16} />
    </Button>
  );
}

function HeaderCenter() {
  return (
    <div className="flex items-center justify-between p-4 mx-4 rounded-t-2xl bg-primary-foreground">
      <span>Projects</span>
      <ButtonRow>
        <IconButton>
          <Plus />
        </IconButton>
        <IconButton>
          <ArrowDownUp />
        </IconButton>
        <IconButton>
          <ListFilter />
        </IconButton>
        <IconButton>
          <Languages />
        </IconButton>
      </ButtonRow>
    </div>
  );
}

function IconButton(props: ButtonProps) {
  return <Button className="px-2" variant="secondary" {...props} />;
}

function ButtonRow({ children }: { children: React.ReactNode[] }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

function Center() {
  const { currentSourcePath } = useNavigation();
  const maybeSplittedPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath
    );
  const remoteSourceContent = useModuleSource(
    maybeSplittedPaths && maybeSplittedPaths[0]
  );
  const remoteSchemasByModuleFilePath = useSchemas();
  if (!maybeSplittedPaths) {
    return <EmptyContent />;
  }
  if (remoteSchemasByModuleFilePath.status === "error") {
    throw new Error(remoteSchemasByModuleFilePath.error);
  }
  if (remoteSourceContent.status === "error") {
    throw new Error(remoteSourceContent.error);
  }
  if (remoteSchemasByModuleFilePath.status !== "success") {
    return <Loading />;
  }
  if (remoteSourceContent.status !== "success") {
    return <Loading />;
  }
  const [moduleFilePath, modulePath] = maybeSplittedPaths;
  const path = currentSourcePath as unknown as SourcePath;

  const moduleSchema = remoteSchemasByModuleFilePath.data[moduleFilePath];
  const moduleSource = remoteSourceContent.data;
  const { source: sourceAtSourcePath, schema: schemaAtSourcePath } =
    Internal.resolvePath(modulePath, moduleSource, moduleSchema);
  return (
    <div className="p-4 mx-4 mb-4 rounded-b-2xl bg-primary-foreground">
      <Module
        path={path}
        source={sourceAtSourcePath}
        schema={schemaAtSourcePath}
      />
    </div>
  );
}

function Module({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
}) {
  if (schema.type === "string") {
    return <StringField path={path} source={source} schema={schema} />;
  } else if (schema.type === "number") {
    return <NumberField path={path} source={source} schema={schema} />;
  } else if (schema.type === "boolean") {
    return <BooleanField path={path} source={source} schema={schema} />;
  } else if (schema.type === "image") {
    return <img />;
  }
  return <UnexpectedSourceType source={source} schema={schema} />;
}

function EmptyContent() {
  return (
    <div className="p-4 mx-4 mb-4 rounded-b-2xl bg-primary-foreground">
      Nothing selected
    </div>
  );
}

function HeaderRight() {
  return (
    <div className="flex items-center justify-end gap-2 p-4">
      <ButtonRow>
        <Button className="px-2 py-2 bg-transparent border-transparent text-foreground">
          <Bell />
        </Button>
        <Button className="h-10 px-2 py-2 bg-transparent border-transparent text-foreground">
          Preview
        </Button>
        <Button className="h-10 bg-transparent border-muted" variant="outline">
          Publish
        </Button>
      </ButtonRow>
    </div>
  );
}

function Right() {
  return (
    <div className="px-5">
      <Divider />
      <PendingChanges />
      <Divider />
      <ValidationErrors />
    </div>
  );
}

function PendingChanges() {
  const items = [
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
  ];
  return (
    <div>
      <div className="p-2">Pending changes ({items.length})</div>
      <div>
        {items.map((item, i) => (
          <div className="flex justify-between p-2 text-xs" key={i}>
            <span className="flex items-center gap-4 ">
              <img src={item} className="w-8 h-8 rounded-full" />
              <span className="truncate">3 changes</span>
            </span>
            <span className="flex items-center gap-4 text-muted-foreground">
              <span className="truncate">2 days ago</span>
              <ChevronDown />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidationErrors() {
  const items = ["Menneskene", "Blogs", "Contact", "Content"];
  return (
    <div>
      <div className="p-2">Validation errors ({items.length})</div>
      <div>
        {items.map((item, i) => (
          <div className="flex justify-between p-2 text-xs" key={i}>
            <span className="flex items-center gap-4 ">{item}</span>
            <span className="flex items-center gap-4 text-muted-foreground">
              <span className="truncate">2 days ago</span>
              <ChevronDown />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayoutBackground() {
  return (
    <div
      className="absolute top-0 left-0 w-full h-full -z-5"
      style={{
        background: `
        radial-gradient(circle 50vw at 42% 20%, rgba(31,42,61,1), rgba(0,0,0,0.4)),
radial-gradient(circle 60vw at 94% 45%, rgba(105,88,119,1), rgba(0,0,0,0.3)),
radial-gradient(circle 80vw at 96% 95%, rgba(86,154,130,1), rgba(0,0,0,0.1)),
radial-gradient(circle 50vw at 28% 23%, rgba(2,8,23,1), rgba(0,0,0,0.7)),
url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='6.48' numOctaves='1' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")
`,
      }}
    />
  );
}

function FakeIcon() {
  return (
    <svg
      width="48"
      height="49"
      viewBox="0 0 48 49"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24.5" r="24" fill="#272D2A" />
      <path
        d="M26.1786 19.4509C23.991 19.4509 22.2502 20.5704 21.1792 22.3943V10.625C19.0041 11.035 18.234 11.1831 16.625 11.4617V11.7854C17.4597 12.0984 17.5849 12.1586 18.2953 12.4749V35.9783H21.1792V33.9703C23.3229 37.4006 28.4665 36.9178 31.0296 34.0707C35.6717 29.5678 33.0961 19.3338 26.1786 19.4509ZM28.3289 33.516C26.5052 35.8101 22.668 35.9222 21.1784 33.4884C21.1784 30.8437 21.1784 25.5225 21.1784 22.8795C22.6581 20.0491 26.7796 20.3537 28.4491 22.8837C30.4758 25.2439 30.5007 31.3515 28.3289 33.516Z"
        fill="#FFFCB6"
      />
    </svg>
  );
}
