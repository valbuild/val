import type { Meta, StoryObj } from "@storybook/react";
import { ModuleMenu } from "./ModuleMenu";
import { Internal, Json, SerializedSchema, initVal } from "@valbuild/core";
import React from "react";

const meta: Meta<typeof ModuleMenu> = { component: ModuleMenu };

export default meta;
type Story = StoryObj<typeof ModuleMenu>;
const onClick = () => {
  // do nothing
};

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

const serializedModules = modules.map((valModule) => {
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

function transform(
  schema: SerializedSchema,
  modulePath?: string
): React.ReactElement[] | React.ReactElement {
  if (schema.type === "array") {
    if (modulePath) {
      return (
        <ModuleMenu.Branch path={modulePath} onClick={onClick}>
          {transform(schema.item)}
        </ModuleMenu.Branch>
      );
    } else {
      return transform(schema.item);
    }
  } else if (schema.type === "object") {
    if (modulePath) {
      return (
        <ModuleMenu.Branch path={modulePath} onClick={onClick}>
          {transform(schema)}
        </ModuleMenu.Branch>
      );
    } else {
      return Object.entries(schema.items).map(([key, schema]) => (
        <ModuleMenu.Branch path={key} onClick={onClick}>
          {transform(schema)}
        </ModuleMenu.Branch>
      ));
    }
  }
  return <div>Error</div>;
}

export const Default: Story = {
  render: () => (
    <>
      {serializedModules.map((serializedModule) =>
        transform(serializedModule.schema, serializedModule.path)
      )}
    </>
  ),
};
