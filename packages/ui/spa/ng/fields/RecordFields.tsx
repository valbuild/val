import {
  ArraySchema,
  BooleanSchema,
  ImageSchema,
  Internal,
  NumberSchema,
  ObjectSchema,
  RecordSchema,
  Schema,
  SelectorSource,
  SourcePath,
  StringSchema,
} from "@valbuild/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { NullSource } from "../components/NullSource";
import { useNavigation } from "../UIProvider";
import { useEffect, useState } from "react";
import { fixCapitalization } from "../../utils/fixCapitalization"; //
import { RecordBadges } from "../components/RecordBadges";
import { formatDateToString } from "../../utils/formatDateToString";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";

export function RecordFields({
  source,
  schema,
  path,
}: {
  source: any;
  schema: RecordSchema<Schema<SelectorSource>>;
  path: SourcePath;
}) {
  if (!source) {
    return <NullSource />;
  }

  const { navigate } = useNavigation();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (schema.item instanceof ObjectSchema) {
      const items = schema.item.items;
      const counts: Record<string, number> = {
        strings: 0,
        numbers: 0,
        objects: 0,
        arrays: 0,
        booleans: 0,
        images: 0,
      };

      Object.entries(items).forEach(([key, item]) => {
        const itemSchema = items[key];
        if (itemSchema instanceof StringSchema) {
          counts.strings++;
        } else if (itemSchema instanceof NumberSchema) {
          counts.numbers++;
        } else if (itemSchema instanceof ObjectSchema) {
          counts.objects++;
        } else if (itemSchema instanceof ArraySchema) {
          counts.arrays++;
        } else if (itemSchema instanceof BooleanSchema) {
          counts.booleans++;
        } else if (itemSchema instanceof ImageSchema) {
          counts.images++;
        }
      });

      setCounts(counts);
    }
  }, [schema.item]);

  const people = [
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Object.entries(source).map(([key, value]) => (
        <Card
          key={key}
          onClick={() => navigate(sourcePathOfItem(path, key))}
          className="bg-primary-foreground cursor-pointer hover:bg-primary-foreground/50 min-w-[274px]"
        >
          <CardHeader>
            <CardTitle className="text-md">{fixCapitalization(key)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RecordBadges counts={counts} />
            <div className="flex items-end justify-between">
              <p className="text-xs text-muted-foreground">
                {formatDateToString(new Date())}
              </p>
              <img
                src={people[Math.floor(Math.random() * people.length)]}
                className="w-8 h-8 rounded-full"
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
