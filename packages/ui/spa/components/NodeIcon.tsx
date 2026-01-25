import { SerializedSchema } from "@valbuild/core";
import {
  Loader2,
  Type,
  Calendar,
  Code,
  FileIcon,
  FileText,
  Hash,
  ImageIcon,
  Key,
  List,
  Split,
  Table,
  ToggleRight,
  HelpCircle,
  Layers,
} from "lucide-react";

export function NodeIcon({
  size,
  type,
  className,
}: {
  size?: number;
  type: SerializedSchema["type"] | "loading";
  className?: string;
}) {
  if (type === "loading") {
    return <Loader2 size={size} className={className} />;
  }

  switch (type) {
    case "string":
      return <Type size={size} className={className} />;
    case "number":
      return <Hash size={size} className={className} />;
    case "boolean":
      return <ToggleRight size={size} className={className} />;
    case "object":
      return <Layers size={size} className={className} />;
    case "literal":
      return <Code size={size} className={className} />;
    case "array":
      return <List size={size} className={className} />;
    case "union":
      return <Split size={size} className={className} />;
    case "richtext":
      return <FileText size={size} className={className} />;
    case "record":
      return <Table size={size} className={className} />;
    case "keyOf":
      return <Key size={size} className={className} />;
    case "file":
      return <FileIcon size={size} className={className} />;
    case "date":
      return <Calendar size={size} className={className} />;
    case "image":
      return <ImageIcon size={size} className={className} />;
    default:
      return <HelpCircle size={size} className={className} />;
  }
}
