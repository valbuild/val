import { Internal, Json, SerializedModule, initVal } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { QueryObject, query } from "./query";

const { s, val } = initVal();

const TEST_DATA = [
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
].map((valModule): SerializedModule => {
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

describe("query", () => {
  test("simplest query possible", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {},
      },
    };

    expect(query(TEST_DATA, paths)).toStrictEqual({
      "/app/about/content": result.ok({
        handbook: {
          title: "Personal&shy;håndbok",
          chapters: [
            {
              header: "Innhold",
              sections: [
                {
                  header: "Intro",
                  slug: "intro",
                  text: "Personalhåndboken er ikke ment å være 100 % utfyllende.",
                },
              ],
              slug: "innhold",
            },
          ],
          ingress: "Her finner det meste du trenger å vite om å jobbe i Blank.",
        },
      }),
    });
  });

  test("query one-key one-level of depth", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {
          title: {},
        },
      },
    };

    expect(query(TEST_DATA, paths)).toStrictEqual({
      "/app/about/content": result.ok({
        handbook: {
          title: "Personal&shy;håndbok",
        },
      }),
    });
  });

  test("query 2-key one-level of depth", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {
          title: {},
          ingress: {},
        },
      },
    };

    expect(query(TEST_DATA, paths)).toStrictEqual({
      "/app/about/content": result.ok({
        handbook: {
          title: "Personal&shy;håndbok",
          ingress: "Her finner det meste du trenger å vite om å jobbe i Blank.",
        },
      }),
    });
  });

  test("query 1-key 1-level array", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {
          chapters: {
            header: {},
          },
        },
      },
    };

    expect(query(TEST_DATA, paths)).toStrictEqual({
      "/app/about/content": result.ok({
        handbook: {
          chapters: [
            {
              header: "Innhold",
            },
          ],
        },
      }),
    });
  });

  test("query 2-key 2-level array", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {
          chapters: {
            header: {},
            sections: {
              header: {},
              slug: {},
            },
          },
        },
      },
    };

    expect(query(TEST_DATA, paths)).toStrictEqual({
      "/app/about/content": result.ok({
        handbook: {
          chapters: [
            {
              header: "Innhold",
              sections: [{ header: "Intro", slug: "intro" }],
            },
          ],
        },
      }),
    });
  });

  test("query with error: missing module", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content2": {
        handbook: {
          title: {},
          ingress: {},
        },
      },
    };

    expectIsErr(query(TEST_DATA, paths)["/app/about/content2"]);
  });

  test("query with error: one missing key, fallback source is correct", () => {
    const paths: Record<string, QueryObject> = {
      "/app/about/content": {
        handbook: {
          title: {},
          ingress: {},
          foo: {},
        },
      },
    };

    const res = query(TEST_DATA, paths)["/app/about/content"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any)?.error?.fallbackSource).toStrictEqual({
      handbook: {
        ingress: "Her finner det meste du trenger å vite om å jobbe i Blank.",
        title: "Personal&shy;håndbok",
      },
    });
  });
});

function expectIsErr(res: result.Result<unknown, unknown> | undefined) {
  if (!res || result.isOk(res)) {
    expect(res).toStrictEqual(result.err({}));
  }
}
