import { SerializedSchema, SourcePath } from "@valbuild/core";
import { useEffect, useState } from "react";
import { FieldLoading } from "./FieldLoading";

export function FieldNotFound({
  path,
  type,
}: {
  path: SourcePath;
  type: SerializedSchema["type"] | "module";
}) {
  const [didTimeout, setDidTimeout] = useState(false);
  useEffect(() => {
    // allow 2 seconds before showing not found
    const timeout = setTimeout(() => {
      setDidTimeout(true);
    }, 2000);
    return () => {
      clearTimeout(timeout);
    };
  }, []);
  if (path.length === 0) {
    return null;
  }
  if (!didTimeout) {
    return <FieldLoading path={path} type={type} />;
  }
  return (
    <div className="pt-6" id={path}>
      <div>Could not get data</div>
    </div>
  );
}
