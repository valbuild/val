import { useState } from "react";
import { Pencil } from "lucide-react";
import {
  FileMetadata,
  ImageMetadata,
  Internal,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";
import { Button } from "../designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { FilenameInput } from "../FileGallery/FilenameInput";
import { useRenameMediaFile } from "../useRenameMediaFile";
import { splitEditableFilename } from "../../utils/renameMediaFile";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { useNavigation } from "../ValRouter";

/**
 * Rename the file of an `s.image()` / `s.file()` field.
 *
 * Only a field that OWNS its file renames it here. A gallery-backed field
 * shares its file with every other field that picked it, so renaming from one
 * of them would change all the others from a place none of them can see — the
 * popover says so and goes to the gallery instead, where the rename shows the
 * references it is about to rewrite.
 */
type RenameFileButtonProps = {
  /** The field. */
  path: SourcePath;
  /** The field's `path` value. */
  filePath: string;
  /** The name shown, e.g. `hero_a1b2c.png`. */
  filename: string;
  metadata: ImageMetadata | FileMetadata | undefined;
  fileType: "image" | "file";
  /** The gallery the field picks from, if it is gallery-backed. */
  referencedModule: ModuleFilePath | undefined;
  disabled?: boolean;
  portalContainer?: HTMLElement | null;
};

export function RenameFileButton(props: RenameFileButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={props.disabled}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Rename
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={props.portalContainer}
        align="start"
        className="w-[clamp(260px,32vw,420px)] p-3"
        // The name input focuses itself; Radix would move focus to the popover
        // instead, leaving an editor who opened "Rename" with nothing to type in.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {/*
         * Mounted only while open, ON PURPOSE: the rename reads the project's
         * schemas, and a subscription to those in every media field wakes every
         * one of them on any schema change - see `perFieldSubscriptions.test.ts`.
         * Nobody is renaming until they have clicked.
         */}
        <RenameFilePanel {...props} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function RenameFilePanel({
  path,
  filePath,
  filename,
  metadata,
  fileType,
  referencedModule,
  close,
}: RenameFileButtonProps & { close: () => void }) {
  const renameMediaFile = useRenameMediaFile(path);
  const { navigate } = useNavigation();
  if (referencedModule) {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <p className="text-fg-secondary">
          This file belongs to {prettyModuleName(referencedModule)}, and other
          fields may use it too. Rename it there, and every field using it
          follows.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const entry = Internal.createValPathOfItem(
              referencedModule,
              filePath,
            );
            close();
            navigate(entry ?? referencedModule);
          }}
        >
          Open in {prettyModuleName(referencedModule)}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-fg-secondary">File name</label>
      <FilenameInput
        filename={filename}
        defaultEditing
        onCancel={close}
        onSave={async (newFilename) => {
          const res = await renameMediaFile({
            kind: "field",
            path: filePath,
            newBase: splitEditableFilename(newFilename).base,
            metadata,
            fileType,
          });
          if (res.status === "error") {
            return res.message;
          }
          close();
          return null;
        }}
      />
    </div>
  );
}
