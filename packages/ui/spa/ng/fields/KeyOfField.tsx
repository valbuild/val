import {
  GenericSelector,
  KeyOfSchema,
  SourceArray,
  SourceObject,
  SourcePath,
} from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../components/ui/select";
import { NullSource } from "../components/NullSource";

export function KeyOfField({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: any;
  schema: KeyOfSchema<GenericSelector<SourceArray | SourceObject>>;
}) {
  if (!source) {
    return <NullSource />;
  }
  if (source === null) {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  return (
    <Select>
      <SelectTrigger className="h-[8ch]">{source}</SelectTrigger>
      <SelectContent>
        <div className="relative pr-6">
          {Object.keys(source).map((key) => (
            <SelectItem className="h-[8ch]" key={key} value={key}>
              {/* <PreviewDropDownItem
                source={
                  isJsonArray(selectorSource)
                    ? selectorSource[Number(key)]
                    : selectorSource[key]
                }
                schema={
                  selectorSchema.type === "object"
                    ? selectorSchema.items[key]
                    : selectorSchema.item
                }
              /> */}
              {JSON.stringify(source[key])}
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
}

export function KeyOfPreview({ source }: { source: any }) {
  return <pre>{JSON.stringify(source)}</pre>;
}
