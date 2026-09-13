import { CopyIcon } from "lucide-react";
import { Button } from "./button";
import { copyText } from "../../utils/copyText";

export function CopyableCodeBlock({ code }: { code: string }) {
  const handleCopy = () => {
    copyText(code);
  };
  return (
    <div className="relative bg-bg-secondary rounded-md p-4 pr-16 my-4">
      <pre className="text-xs overflow-x-auto ">
        <code>{code}</code>
      </pre>
      <Button
        variant="secondary"
        size="sm"
        className="absolute top-2 right-2"
        onClick={handleCopy}
      >
        <CopyIcon size={16} className="mr-2" />
      </Button>
    </div>
  );
}
