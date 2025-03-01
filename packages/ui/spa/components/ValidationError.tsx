import { SourcePath, ValidationError } from "@valbuild/core";
import { useErrors } from "./ValProvider";
import { Accordion } from "@radix-ui/react-accordion";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";

export function ValidationErrors({ path }: { path: SourcePath }) {
  const { validationErrors } = useErrors();

  const errors: (ValidationError & { path: string })[] = [];
  for (const errorPath in validationErrors) {
    if (errorPath.startsWith(path)) {
      errors.push(
        ...validationErrors[errorPath as SourcePath].map((error) => ({
          ...error,
          path: errorPath,
        })),
      );
    }
  }
  if (errors.length === 0) {
    return null;
  }
  if (errors.length === 1) {
    return (
      <div className="p-4 font-normal rounded bg-bg-error-primary text-text-primary">
        <div>{errors[0].message}</div>
        <div className="pl-4 font-thin">at {errors[0].path}</div>
      </div>
    );
  }
  return (
    <Accordion type="single" collapsible>
      <AccordionItem
        value="validation-errors"
        className="font-normal rounded bg-bg-error-primary text-text-primary"
      >
        <AccordionTrigger className="p-4">
          <div className="flex justify-between w-full">
            <span className="truncate">Multiple validation Errors</span>
            <span className="pr-4">({errors.length})</span>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {errors.map((error) => (
            <div key={error.path} className="px-4">
              <div>{error.message}</div>
              <div className="pl-4 font-thin">at {error.path}</div>
            </div>
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
