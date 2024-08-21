import { Plus } from "lucide-react";
import { SortableList } from "../SortableList";
import { JsonArray, SourcePath, SerializedArraySchema } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Patch } from "@valbuild/core/patch";
import { useState, useEffect } from "react";
import { emptyOf } from "../../emptyOf";
import { InitOnSubmit } from "../ValFormField";
import { useNavigate } from "../../ValRouter";
import { FieldContainer } from "../FieldContainer";

export function ArrayFields({
  path,
  source,
  schema,
  initOnSubmit,
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  const navigate = useNavigate();
  const onSubmit = initOnSubmit(path);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentSource, setCurrentSource] = useState<JsonArray>(source);
  useEffect(() => {
    setCurrentSource(source);
  }, [source]);
  return (
    <FieldContainer key={path} className="flex flex-col items center">
      <button
        className="self-end px-2"
        onClick={() => {
          setLoading(true);
          onSubmit(async (path) => {
            return [
              {
                op: "add",
                path: path.concat("0"),
                value: emptyOf(schema.item) as JSONValue,
              },
            ];
          })
            .then(async () => {
              setCurrentSource((source) =>
                [emptyOf(schema.item)].concat(...source)
              );
            })
            .finally(() => {
              setLoading(false);
            });
        }}
      >
        <Plus />
      </button>
      <div className="flex flex-col gap-4 p-2">
        <SortableList
          path={path}
          source={currentSource}
          schema={schema}
          loading={loading}
          onDelete={async (item) => {
            setLoading(true);
            return onSubmit(async (path) => {
              return [
                {
                  op: "remove",
                  path: path.concat(
                    item.toString()
                  ) as array.NonEmptyArray<string>,
                },
              ];
            })
              .catch((err) => {
                console.error("Could not delete item", err);
              })
              .finally(() => {
                setLoading(false);
              });
          }}
          onMove={async (from, to) => {
            return onSubmit(async (path) => {
              const fromPath = path.concat(from.toString());
              const toPath = path.concat(to.toString());
              return [
                {
                  op: "move",
                  from: fromPath,
                  path: toPath,
                },
              ] as Patch;
            })
              .catch((err) => {
                console.error("Could not move item", err);
              })
              .finally(() => {
                setLoading(false);
              });
          }}
          onClick={(path) => {
            if (!loading) {
              navigate(path);
            }
          }}
        />
      </div>
      {currentSource.length > 0 && (
        <button
          className="self-end px-2"
          onClick={() => {
            setLoading(true);
            onSubmit(async (path) => {
              return [
                {
                  op: "add",
                  path: path.concat("-") as array.NonEmptyArray<string>,
                  value: emptyOf(schema.item) as JSONValue,
                },
              ];
            })
              .then(() => {
                setCurrentSource((source) =>
                  source.concat(emptyOf(schema.item))
                );
              })
              .finally(() => {
                setLoading(false);
              });
          }}
        >
          <Plus />
        </button>
      )}
    </FieldContainer>
  );
}
