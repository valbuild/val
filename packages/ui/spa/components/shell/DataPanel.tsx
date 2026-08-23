import { ReactNode, useMemo, useState } from "react";
import { Braces, Plus } from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import {
  PanelErrorState,
  PanelFilterInput,
  PanelRow,
  PanelSkeleton,
} from "./PanelPrimitives";
import { ShellBreakpoint, ShellDataModule } from "./types";

export type DataPanelProps = {
  breakpoint: ShellBreakpoint;
  data: ShellDataModule[];
  selectedId: string | null;
  onSelect: (module: ShellDataModule) => void;
  onNewDataFile: () => void;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/** Non-router val modules: settings, navigation, records, lookup tables. */
export function DataPanel({
  breakpoint,
  data,
  selectedId,
  onSelect,
  onNewDataFile,
  onClose,
  navSwitcher,
  isLoading,
  loadError,
  onRetryLoad,
}: DataPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query) return data;
    const q = query.toLowerCase();
    return data.filter(
      (module) =>
        module.name.toLowerCase().includes(q) ||
        module.moduleFilePath.toLowerCase().includes(q),
    );
  }, [data, query]);
  return (
    <FloatingPanel
      side="left"
      width={300}
      title="Data"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
      headerAction={
        <button
          type="button"
          onClick={onNewDataFile}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Plus size={13} />
          New
        </button>
      }
      sticky={
        isLoading || loadError ? undefined : (
          <PanelFilterInput
            value={query}
            onChange={setQuery}
            placeholder="Filter data files…"
          />
        )
      }
    >
      <div className="py-2">
        {isLoading ? (
          <PanelSkeleton />
        ) : loadError ? (
          <PanelErrorState message={loadError} onRetry={onRetryLoad} />
        ) : filtered.length === 0 ? (
          <PanelEmptyState>
            {query ? "No data files match this filter." : "No data files yet."}
          </PanelEmptyState>
        ) : (
          filtered.map((module) => (
            <PanelRow
              key={module.id}
              selected={selectedId === module.id}
              title={module.moduleFilePath}
              onClick={() => onSelect(module)}
              leading={<Braces size={13} className="text-fg-secondary-alt" />}
              label={module.name}
              errorCount={module.errorCount}
              hasDraft={module.hasDraft}
            />
          ))
        )}
      </div>
    </FloatingPanel>
  );
}
