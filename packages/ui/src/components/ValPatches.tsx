import {
  ApiPostValidationErrorResponse,
  ApiPostValidationResponse,
  ModuleId,
  PatchId,
  SourcePath,
  ValApi,
} from "@valbuild/core";
import { ChevronDown, Diff, X } from "lucide-react";
import { Button } from "./ui/button";
import { result } from "@valbuild/core/fp";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent } from "./ui/accordion";
import { AccordionItem, AccordionTrigger } from "@radix-ui/react-accordion";

export type ValPatchesProps = {
  api: ValApi;
  isValidating: boolean;
  validationResponse: {
    globalError: null | { message: string; details?: unknown };
    errors?: ApiPostValidationResponse | ApiPostValidationErrorResponse;
  };
  patches: Record<ModuleId, PatchId[]>;
  onCommit: () => void;
  onCancel: () => void;
};
export function ValPatches({
  api,
  isValidating,
  patches: patchIdsByModule,
  validationResponse,
  onCommit,
  onCancel,
}: ValPatchesProps) {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <Container>
      <div className="flex justify-end p-2">
        <button onClick={onCancel}>
          <X />
        </button>
      </div>
      <div className="flex flex-col items-center justify-center h-full p-8 gap-y-5">
        <ReviewPanel />
        <div className="flex gap-x-4">
          <Button variant={"secondary"} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={isValidating || loading}
            onClick={() => {
              setLoading(true);
              api
                .postCommit({ patches: patchIdsByModule })
                .then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    if ("validationErrors" in res.error) {
                      alert("Cannot commit invalid patches");
                    } else {
                      alert("Could not commit patches: " + res.error.message);
                    }
                  } else {
                    console.log("Committed patches: ", res.value);
                    onCommit();
                  }
                })
                .finally(() => {
                  setLoading(false);
                });
            }}
          >
            {loading ? "Committing..." : "Commit"}
          </Button>
        </div>
      </div>
    </Container>
  );
}

type Author = {
  name: string;
};
type HistoryItem = (
  | {
      path: SourcePath;
      type: "replace" | "move" | "add" | "remove";
    }
  | {
      filename: string;
    }
) & {
  author?: string;
  date?: string;
};
export type History = [Author, [ModuleId, HistoryItem[]][]];

export type ReviewErrors = [
  ModuleId,
  {
    path: SourcePath;
    message: string;
    lastChangedBy: string;
    lastedChangedAt?: string;
  }[]
];

export function ReviewPanel({
  history,
  errors,
}: {
  history: History;
  errors: ReviewErrors;
}) {
  return (
    <div>
      <h1 className="block font-sans text-xl font-bold">Review changes</h1>
      <h2>History</h2>
      <ul>
        <li></li>
      </ul>
    </div>
  );
}

function Container({
  children,
}: {
  children: React.ReactNode | React.ReactNode[];
}) {
  return (
    <div className="h-full w-full rounded-lg bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg text-primary drop-shadow-2xl">
      {children}
    </div>
  );
}
