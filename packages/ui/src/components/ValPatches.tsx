import { ModuleId, ValApi } from "@valbuild/core";
import { ChevronDown, Diff, X } from "lucide-react";
import { Button } from "./ui/button";
import { result } from "@valbuild/core/fp";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent } from "./ui/accordion";
import { AccordionItem, AccordionTrigger } from "@radix-ui/react-accordion";

export function ValPatches({
  api,
  patches: patchIdsByModule,
  onCommit,
  onCancel,
}: {
  api: ValApi;
  patches: Record<ModuleId, string[]>;
  onCommit: () => void;
  onCancel: () => void;
}) {
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
        <h1 className="block font-sans text-xl font-bold">Review changes</h1>
        <ul>
          {Object.entries(patchIdsByModule).map(([moduleId, patchIds]) => (
            <li key={moduleId}>
              <Accordion type="single" collapsible>
                <AccordionItem value={moduleId}>
                  <AccordionTrigger className="grid grid-cols-[1fr_min-content] gap-x-2">
                    <span>{moduleId}</span>
                    <span className="flex">
                      <Diff size={14} />
                      <span>{patchIds.length}</span>
                      <span>
                        <ChevronDown size={14} />
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Accordion type="multiple">
                      {patchIds.map((patchId) => (
                        <AccordionItem value={patchId}>
                          <AccordionTrigger>
                            <div className="flex items-center gap-x-5">
                              <span>Changed by: John Smith</span>
                              <span>Changed at: 2024-01-04 13:25:00</span>
                              <img
                                className="h-[14px] w-[14px]"
                                src="https://randomuser.me/api/portraits/men/3.jpg"
                              ></img>
                              <X size={14} />
                              <ChevronDown size={14} />
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div>Changed to: "Foo bar"</div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </li>
          ))}
        </ul>
        <div className="flex gap-x-4">
          <Button variant={"secondary"} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={Object.keys(patchIdsByModule).length === 0 || loading}
            onClick={() => {
              setLoading(true);
              api
                .postCommit({ patches: patchIdsByModule })
                .then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    alert("Could not commit patches: " + res.error.message);
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
