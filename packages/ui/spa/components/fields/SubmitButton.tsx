import { ValidationError } from "@valbuild/core";
import { InlineValidationErrors } from "./InlineValidationErrors";
import { Button } from "../ui/button";
import { useValUIContext } from "../ValUIContext";

export function SubmitButton({
  loading,
  enabled,
  validationErrors,
  onClick,
}: {
  loading: boolean;
  enabled: boolean;
  validationErrors?: false | ValidationError[];
  onClick: () => void;
}) {
  const { session } = useValUIContext();
  const isProxy = session.status === "success" && session.data.mode === "proxy";
  return (
    <div className="sticky bottom-0 m-4 mt-2 ml-0">
      <div className="grid justify-start gap-2 text">
        {validationErrors ? (
          <InlineValidationErrors errors={validationErrors || []} />
        ) : (
          <span></span>
        )}
        <Button disabled={loading || !enabled} onClick={onClick}>
          {loading
            ? isProxy
              ? "Staging..."
              : "Saving..."
            : isProxy
            ? "Stage"
            : "Save"}
        </Button>{" "}
      </div>
    </div>
  );
}
