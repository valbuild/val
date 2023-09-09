import type { Meta, StoryObj } from "@storybook/react";
import { JsonPath, ModuleMenu } from "./ModuleMenu";
import {
  Internal,
  Json,
  SerializedSchema,
  initVal,
  SourcePath,
} from "@valbuild/core";
import React, { useEffect } from "react";
import { MobileCard as MobileCard } from "./MobileCard";
import jp from "jsonpath";
import { TextForm } from "../forms/TextForm";
import { SchemaIcon } from "./SchemaIcon";
import { query, QueryObject } from "../../utils/query";
import { deepClone } from "@valbuild/core/patch";

const meta: Meta = { title: "components/dashboard/Mobile" };

export default meta;
type Story = StoryObj;

const { s, val } = initVal();
const modules = [
  val.content(
    "/app/about/content",
    s.object({
      handbook: s.object({
        title: s.string(),
        ingress: s.string().optional(),
        chapters: s.array(
          s.object({
            header: s.string(),
            slug: s.string(),
            sections: s.array(
              s.object({
                header: s.string(),
                slug: s.string(),
                text: s.string(),
              })
            ),
          })
        ),
      }),
    }),
    {
      handbook: {
        title: "Personal&shy;håndbok",
        ingress: "Her finner det meste du trenger å vite om å jobbe i Blank.",
        chapters: [
          {
            header: "Innhold",
            slug: "innhold",
            sections: [
              {
                header: "Intro",
                slug: "intro",
                text: "Personalhåndboken er ikke ment å være 100 % utfyllende.",
              },
            ],
          },
        ],
      },
    }
  ),
  val.content(
    "/app/conditions",
    s.object({
      header: s.string(),
      description: s.string(),
      conditions: s.array(
        s.object({
          title: s.string(),
          content: s.string(),
        })
      ),
    }),
    {
      header: "Lønn og goder i Blank",
      description:
        "Det er vanskelig å orientere seg i markedet om hva som er konkurransedyktig lønn og vanlige goder. Derfor har kan du lese litt mer om våre betingelser og tankene bak her. Vi håper det kan være til nytte.",
      conditions: [
        {
          title: "Fastlønn",
          content: `For å bestemme fastlønn har vi helt siden starten hatt som mål å gjøre det enkelt og åpent. Vi har god oversikt over lønnsnivået i bransjen, og etter å ha studert ulike tall og statistikker, bestemte vi oss for å ta utgangspunkt i Teknas lønnsstatistikk. Grafen for øvre kvartil i privat sektor var nærmest der vi tenkte vi skulle være. Denne trengte bare litt glatting og kjærlighet før vi kunne benytte denne som lønnsstige. Variasjoner vil selvsagt eksistere – for eksempel ved at enkeltpersoner kan bli forfremmet fra sitt eksamenskull – men siden vi har åpne lønnsbøker må slike avgjørelser i så tilfelle kunne forsvares av ledelsen.`,
        },
      ],
    }
  ),
  val.content(
    "/app/employees",
    s.array(
      s.object({
        name: s.string(),
        slug: s.string(),
        phoneNumber: s.string(),
        email: s.string(),
      })
    ),
    [
      {
        name: "Fredrik Ekholdt",
        slug: "fe",
        phoneNumber: "+47 123456789",
        email: "you@wish.com",
      },
    ]
  ),
];

type SerializedModule = {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
};
const serializedModules = modules.map((valModule): SerializedModule => {
  const path = Internal.getValPath(valModule);
  const schema = Internal.getSchema(valModule)?.serialize();
  const source = Internal.getVal(valModule).val as Json;

  if (!path) {
    throw new Error("Path not found: " + JSON.stringify(valModule));
  }
  if (!schema) {
    throw new Error("Schema not found: " + Internal.getValPath(valModule));
  }

  return {
    path,
    source,
    schema,
  };
});

export const Default: Story = {
  render: () => {
    const [queryObject, setQueryObject] = React.useState<
      Record<string, QueryObject>
    >({});
    const [selectedQueryPath, setSelectedQueryPath] = React.useState<
      Record<string, string[]> // an object to avoid having to escape paths
    >({});
    const onSelect = (queryPath: string[]) => {
      setSelectedQueryPath((prev) => {
        if (prev[queryPath.join(".")]) {
          return {
            ...prev,
            [queryPath.join(".")]: undefined,
          } as Record<string, string[]>;
        } else {
          return {
            ...prev,
            [queryPath.join(".")]: queryPath,
          };
        }
      });
    };
    useEffect(() => {
      setQueryObject(() => {
        const next: Record<string, QueryObject> = {};
        let curr = next;
        for (const queryPath of Object.values(selectedQueryPath)) {
          for (const segment of queryPath || []) {
            curr[segment] = curr[segment] || {};
            curr = curr[segment] || {};
          }
          curr = next;
        }
        return { ...next };
      });
    }, [selectedQueryPath]);

    function transform(
      queryPath: string[],
      schema: SerializedSchema
    ): React.ReactElement[] | React.ReactElement | null {
      if (schema.type === "array") {
        return transform(queryPath, schema.item);
      } else if (schema.type === "i18n") {
        return transform(queryPath, schema.item);
      } else if (schema.type === "object") {
        return Object.entries(schema.items).map(([key, schema]) => {
          if (schema.type !== "object" && schema.type !== "array") {
            return (
              <ModuleMenu.Leaf
                key={queryPath.concat(key).join(".")}
                icon={<SchemaIcon type="string" />}
                onSelect={onSelect}
                queryPath={queryPath.concat(key)}
                selected={false}
              >
                {key}
              </ModuleMenu.Leaf>
            );
          }
          return (
            <ModuleMenu.Branch
              icon={<SchemaIcon type={schema.type} />}
              key={queryPath.join(".")}
              name={key}
              queryPath={queryPath}
              selected={false}
              onSelect={onSelect}
            >
              {transform(queryPath.concat(key), schema)}
            </ModuleMenu.Branch>
          );
        });
      }
      return null;
    }
    console.log(JSON.stringify(queryObject, null, 2));
    // console.log(query(serializedModules, queryObject));
    return (
      <div className="max-w-[400px] bg-fill">
        <ModuleMenu>
          {serializedModules.map((serializedModule) => {
            const queryPath = [serializedModule.path];
            return (
              <ModuleMenu.Branch
                icon={<SchemaIcon type={"module"} />}
                key={queryPath.join(".")}
                name={serializedModule.path}
                queryPath={queryPath}
                selected={false}
                onSelect={onSelect}
              >
                {transform(queryPath, serializedModule.schema)}
              </ModuleMenu.Branch>
            );
          })}
        </ModuleMenu>
        <div className="p-4">
          <MobileCard>
            <MobileCard.Header path="/about/blank/content">
              <MobileCard.Summary
                name="Text objects"
                number={2}
                icon={<SchemaIcon type="string" />}
              />
              <MobileCard.Summary
                name="Chapters"
                number={11}
                icon={<SchemaIcon type="array" />}
              />
            </MobileCard.Header>
            <MobileCard.Content>
              <MobileCard.ContentRow
                name="Title"
                icon={<SchemaIcon type="string" />}
              >
                <PreviewText
                  text="Personalhåndbok"
                  onClick={() => {
                    //
                  }}
                />
              </MobileCard.ContentRow>
              <MobileCard.ContentRow
                name="Ingress"
                icon={<SchemaIcon type="string" />}
              >
                <TextForm
                  name="Ingress"
                  onChange={() => {
                    //
                  }}
                  text="Bla bla bla"
                />
              </MobileCard.ContentRow>
              <MobileCard.ContentRow
                name="Chapters"
                amount={11}
                icon={<SchemaIcon type="array" />}
              >
                <MobileCard.Content>
                  <MobileCard.ContentRow
                    name="Inner"
                    amount={11}
                    icon={<SchemaIcon type="richtext" />}
                  />
                </MobileCard.Content>
              </MobileCard.ContentRow>
            </MobileCard.Content>
          </MobileCard>
        </div>
      </div>
    );
  },
};

function PreviewText({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      className="w-full px-4 py-1 font-serif text-left bg-input text-inverse"
      onClick={onClick}
    >
      {text}
    </button>
  );
}
