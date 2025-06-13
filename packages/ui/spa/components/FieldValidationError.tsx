import { ChevronDown, TriangleAlert } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";
import { cn } from "./designSystem/cn";
import { ValidationError } from "@valbuild/core";
import { useState, useRef, useEffect } from "react";

export function FieldValidationError({
  validationErrors,
}: {
  validationErrors: ValidationError[];
}) {
  return (
    <div
      className={cn("w-full", {
        "h-6": validationErrors.length === 0,
      })}
    >
      {validationErrors.length > 1 && (
        <Accordion type="single" collapsible className="w-full min-h-6">
          <AccordionItem
            value="validation-errors"
            className="w-full border-b-0 group"
          >
            <AccordionTrigger className="px-2 border-b-0 min-h-6">
              <div className="flex items-center justify-between w-full">
                <div className="text-text-primary">
                  {validationErrors.length} validation error
                  {validationErrors.length > 1 ? "s" : ""}
                </div>
                <div className="text-bg-error-secondary">
                  <TriangleAlert size={16} />
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-2">
                {validationErrors.map((error, i) => (
                  <div
                    key={i}
                    className="px-2 py-2 rounded-md hover:bg-bg-secondary_subtle"
                  >
                    {error.message}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {validationErrors.length === 1 && validationErrors[0] && (
        <SingleValidationError validationError={validationErrors[0]} />
      )}
    </div>
  );
}

function SingleValidationError({
  validationError,
}: {
  validationError: ValidationError;
}) {
  const [open, setOpen] = useState(false);
  const [showChevron, setShowChevron] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkTextOverflow = () => {
      if (textRef.current) {
        // Create a test element with the same content and styling but without line-clamp
        const testElement = document.createElement("div");
        const computedStyle = window.getComputedStyle(textRef.current);

        // Copy relevant styles but remove line clamp
        testElement.style.cssText = computedStyle.cssText;
        testElement.style.position = "absolute";
        testElement.style.visibility = "hidden";
        testElement.style.left = "-9999px";
        testElement.style.width = computedStyle.width;
        testElement.style.webkitLineClamp = "unset";
        testElement.style.overflow = "visible";
        testElement.style.display = "block";
        testElement.textContent = validationError.message;

        document.body.appendChild(testElement);
        const fullHeight = testElement.getBoundingClientRect().height;
        document.body.removeChild(testElement);

        // Get the current height of the clamped element
        const clampedHeight = textRef.current.getBoundingClientRect().height;

        // Show chevron if the full text is taller than the clamped version
        setShowChevron(fullHeight > clampedHeight + 1); // Adding 1px tolerance for rounding
      }
    };

    // Use a small delay to ensure DOM is ready and styles are applied
    const timeoutId = setTimeout(checkTextOverflow, 50);

    window.addEventListener("resize", checkTextOverflow);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", checkTextOverflow);
    };
  }, [validationError.message]);

  return (
    <div
      ref={containerRef}
      className="flex items-start justify-between w-full pt-2 pb-2 transition-all duration-200 ease-in-out"
      style={{
        height: open ? "auto" : undefined,
      }}
    >
      <div
        ref={textRef}
        className={cn(
          "text-text-primary transition-all duration-200 ease-in-out",
          {
            "line-clamp-1": !open,
          },
        )}
        style={{
          flex: showChevron ? "1" : "auto",
          marginRight: showChevron ? "8px" : "0",
        }}
      >
        {validationError.message}
      </div>
      {showChevron && (
        <button
          className="flex items-center flex-shrink-0"
          onClick={() => setOpen(!open)}
        >
          <div className="text-bg-error-secondary">
            <TriangleAlert size={16} />
          </div>
          <ChevronDown
            size={16}
            className={cn(
              "transform transition-transform duration-200 ease-in-out",
              {
                "rotate-180": open,
              },
            )}
          />
        </button>
      )}
    </div>
  );
}
