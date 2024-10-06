import {
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import FlexSearch from "flexsearch";

function rec(
  source: Json,
  schema: SerializedSchema,
  path: SourcePath,
  sourceIndex: FlexSearch.Index,
  sourcePathIndex: FlexSearch.Index,
): void {
  const isRoot = path.endsWith("?p="); // skip root module
  if (
    !isRoot // skip root module
  ) {
    addTokenizedSourcePath(sourcePathIndex, path);
  }
  if (!schema?.type) {
    throw new Error("Schema not found for " + path);
  }
  if (source === null) {
    return;
  }
  if (schema.type === "richtext") {
    addTokenizedSourcePath(sourcePathIndex, path);
    sourceIndex.add(path, stringifyRichText(source));
    return;
  } else if (schema.type === "array") {
    if (!Array.isArray(source)) {
      throw new Error(
        "Expected array, got " + typeof source + " for " + path + ": " + source,
      );
    }
    for (let i = 0; i < source.length; i++) {
      const subPath = path + (isRoot ? "" : ".") + i;
      if (!schema?.item) {
        throw new Error(
          "Schema (" + schema.type + ") item not found for " + subPath,
        );
      }
      rec(
        source[i],
        schema?.item,
        subPath as SourcePath,
        sourceIndex,
        sourcePathIndex,
      );
    }
  } else if (schema.type === "object" || schema.type === "record") {
    if (typeof source !== "object") {
      throw new Error(
        "Expected object, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
    for (const key in source) {
      const subSchema =
        schema.type === "object" ? schema?.items?.[key] : schema?.item;
      const subPath = (path +
        (isRoot ? "" : ".") +
        JSON.stringify(key)) as SourcePath;

      if (!subSchema) {
        throw new Error(
          "Object schema  (" +
            schema.type +
            ") item(s) not found for " +
            subPath,
        );
      }
      if (source && typeof source === "object") {
        if (!(key in source)) {
          throw new Error(
            `Object schema does is missing required key: ${key} in ${path}`,
          );
        }
        rec(source[key], subSchema, subPath, sourceIndex, sourcePathIndex);
      } else {
        throw new Error(
          `Object schema does not have source of correct type: ${typeof source}, key: ${key} for ${path}`,
        );
      }
    }
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      const schemaKey = schema.key;
      const subSchema = schema.items.find((item) => {
        if (item.type !== "object") {
          throw new Error(
            `Union schema must have sub object of object but has: (${item.type}) for ${path}`,
          );
        }
        const schemaAtKey = item.items[schemaKey];
        if (schemaAtKey.type !== "literal") {
          throw new Error(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `Union schema must have sub object with literal key but has: ${(item.items as any)?.[schemaKey]?.type} for ${path}`,
          );
        }
        if (source && typeof source === "object" && schemaKey in source) {
          return schemaAtKey.value === source[schemaKey];
        }
        throw new Error(
          `Union schema must have sub object with literal key but has: ${item.items[schemaKey]} for ${path}`,
        );
      });
      if (!subSchema) {
        throw new Error(
          "Union schema  (" + schema.type + ") item(s) not found for " + path,
        );
      }
      rec(source, subSchema, path, sourceIndex, sourcePathIndex);
    }
  } else if (schema.type === "string") {
    if (typeof source !== "string") {
      throw new Error(
        "Expected string, got " +
          typeof source +
          " for " +
          path +
          ": " +
          source,
      );
    }
    if (typeof source === "string") {
      sourceIndex.add(path, source);
    }
  } else if (schema.type === "keyOf" || schema.type === "date") {
    if (typeof source === "string") {
      sourceIndex.add(path, source);
    }
  } else if (schema.type === "number") {
    if (typeof source === "number") {
      sourceIndex.add(path, source.toString());
    }
  }
}

function stringifyRichText(source: Json): string {
  let res = "";
  function rec(child: Json): void {
    if (typeof child === "string") {
      res += child;
    } else {
      if (
        child &&
        typeof child === "object" &&
        "children" in child &&
        Array.isArray(child.children)
      ) {
        for (const c of child.children) {
          rec(c);
        }
      }
    }
  }
  rec({ children: source });
  return res;
}

function isUpperCase(char: string) {
  // Check if the character is a letter and if it's uppercase
  return char.toUpperCase() === char && char.toLowerCase() !== char;
}

function splitOnCase(str: string) {
  const result: string[] = [];
  let currentWord = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (i !== 0 && isUpperCase(char)) {
      result.push(currentWord);
      currentWord = char;
    } else {
      currentWord += char;
    }
  }

  if (currentWord) {
    result.push(currentWord);
  }

  return result;
}

function tokenizeSourcePath(sourcePath: SourcePath | ModuleFilePath) {
  const tokens: string[] = [sourcePath]; // add full path
  const existingTokens = new Set();
  const moduleFilePathIndex = sourcePath.indexOf("?p=");
  const moduleFilePath = sourcePath.slice(
    0,
    moduleFilePathIndex === -1 ? sourcePath.length : moduleFilePathIndex,
  ) as ModuleFilePath;
  const parts = moduleFilePath.split("/").slice(1); // skip first empty part
  const lastPart = sourcePath.slice(
    moduleFilePathIndex + 1,
    sourcePath.length + 1,
  );
  for (const part of parts) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  const fileExtLength = 7; // length of .val.[tj]s
  if (
    !(moduleFilePath.endsWith(".val.ts") || moduleFilePath.endsWith(".val.js"))
  ) {
    throw new Error(
      "Unsupported file extension: " + moduleFilePath + " for " + sourcePath,
    );
  }
  const filenameWithoutExt = moduleFilePath.slice(0, -fileExtLength);
  tokens.push(...splitOnCase(filenameWithoutExt), filenameWithoutExt);

  const modulePath = lastPart as ModulePath;
  if (!modulePath) {
    return tokens;
  }
  for (const part of splitModulePath(modulePath as ModulePath)) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  return tokens;
}

function addTokenizedSourcePath(
  sourcePathIndex: FlexSearch.Index,
  sourcePath: SourcePath | ModuleFilePath,
) {
  sourcePathIndex.add(sourcePath, tokenizeSourcePath(sourcePath).join(" "));
}

function index(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
): Record<
  ModuleFilePath,
  { sourcePath: FlexSearch.Index; source: FlexSearch.Index }
> {
  console.time("indexing");
  const indices: Record<
    ModuleFilePath,
    { sourcePath: FlexSearch.Index; source: FlexSearch.Index }
  > = {};
  for (const moduleFilePathS in modules) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;

    indices[moduleFilePath] = {
      sourcePath: new FlexSearch.Index(),
      source: new FlexSearch.Index(),
    };

    const { source, schema } = modules[moduleFilePath];
    addTokenizedSourcePath(indices[moduleFilePath].sourcePath, moduleFilePath);

    rec(
      source,
      schema,
      (moduleFilePathS + "?p=") as SourcePath,
      indices[moduleFilePath].source,
      indices[moduleFilePath].sourcePath,
    );
  }
  console.timeEnd("indexing");
  return indices;
}

function search(
  indices: Record<
    ModuleFilePath,
    { sourcePath: FlexSearch.Index; source: FlexSearch.Index }
  >,
  query: string,
) {
  console.time("search: " + query);

  let results: FlexSearch.Id[] = [];
  for (const moduleFilePathS in indices) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const { sourcePath } = indices[moduleFilePath];
    results = results.concat(sourcePath.search(query));
  }
  if (results.length === 0) {
    for (const moduleFilePathS in indices) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const { source } = indices[moduleFilePath];
      results = results.concat(...source.search(query));
    }
  }
  console.timeEnd("search: " + query);
  return results as SourcePath[];
}

async function main(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
) {
  const query = process.argv[2];

  const indices = index(modules);
  console.log(search(indices, query));
}

main({
  "/content/basic.val.ts": {
    source: true,
    schema: {
      type: "boolean",
      opt: false,
    },
  },
  "/content/events/series.val.ts": {
    source: {
      kjoregaar: {
        title: "Kjøregår",
      },
      fest: {
        title: "Fest",
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          title: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/projects.val.ts": {
    source: {
      aidn: {
        order: 1,
        colorScheme: {
          backgroundColor: "#FDF2E6",
          textColor: "#351B44",
        },
        content: [
          {
            alt: null,
            size: null,
            type: "singleImageElement",
            image: {
              _ref: "/public/",
              _type: "file",
              metadata: {
                width: 0,
                height: 0,
                sha256: "",
                mimeType: "application/octet-stream",
              },
            },
            clickable: null,
            keepAspectRatio: null,
          },
          {
            alt: null,
            size: null,
            type: "singleImageElement",
            image: {
              _ref: "/public/",
              _type: "file",
              metadata: {
                width: 0,
                height: 0,
                sha256: "",
                mimeType: "application/octet-stream",
              },
            },
            clickable: null,
            keepAspectRatio: null,
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/c496e1057e473603a1744b8f0c20d62c784d13ff-1888x1379.webp",
              _type: "file",
              metadata: {
                width: 1888,
                height: 1379,
                sha256:
                  "97188de51a94d396341e04c9ed5d1f6a7c68126f0c99f771f97b677aaab3f4d5",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "videoElement",
            video: {
              _ref: "/public/videos/aidn.mp4",
              _type: "file",
              metadata: {
                sha256:
                  "2cf1a11b35807ea3f5ff2fe5feeb1502cb61cc0f2ed6e76a8d1815637178fffd",
                mimeType: "video/mp4",
              },
            },
          },
        ],
        hero: {
          description:
            "Nytt journalsystem for dokumentasjon og samarbeid i helsevesenet.",
          image: {
            _ref: "/public/images/e5167937f78926b4a202fd487ecea76e6ea36096-2240x1260.webp",
            _type: "file",
            metadata: {
              width: 1667,
              height: 1080,
              sha256:
                "e205f4431afc224a34b5c3ac4225b3df6eca3afa74e81cbd21cfec43accb6696",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            client: "Aidn",
            contribution: "Design og utvikling",
            description:
              "Aidn har gått til kamp mot dagens utdaterte dokumentasjons- og rapporteringsverktøy i det kommunale helsevesenet og bygger derfor et helt nytt skybasert, smart pasientsystem som radikalt skal lette arbeidshverdagen for helseteamene rundt pasienten. Dette er den største investeringen innen e-helseløsninger kommunemarkedet noen gang har sett.",
          },
          shortDescription:
            "Nytt journalsystem for dokumentasjon og samarbeid i helsevesenet",
          title: "aidn",
        },
      },
      bboy: {
        order: 2,
        hero: {
          description:
            "Blanks korteste stunt-prosjekt; ett spill lagd på 3 uker i forbindelse med rapperen B-Boy Myhres albumslipp. ",
          image: {
            _ref: "/public/images/c93c5581bca31cf38e403db803a1ff7e813bc56d-1100x1022.webp",
            _type: "file",
            metadata: {
              width: 1100,
              height: 1022,
              sha256:
                "b6d8c16a651143a0f368dafc69ccc5413aedf0e080248187676b3f0c46fe41ed",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            client: "B-Boy Myhre og Little Big Sister",
            contribution: "Design og utvikling",
            description:
              'I forbindelse med B-Boy Myhre sitt albumslipp lagde vi et runnerspill for å skape blest rundt albumet og hans kommende konserter. Spillet passer perfekt inn i B-Boy Myhres univers som enkelt kan beskrives som — "digitalt stusselig". ',
          },
          shortDescription:
            "Blanks korteste stunt-prosjekt; ett spill lagd på 3 uker i forbindelse med rapperen B-Boy Myhres albumslipp. ",
          title: "B-Boy Myhre",
        },
        colorScheme: {
          backgroundColor: "#282D2A",
          textColor: "#71E25A",
        },
        content: [
          {
            type: "doubleImageElement",
            alt: "",
            clickable: false,
            size: "lg",
            image1: {
              _ref: "/public/images/f8d6f0afbd18a013d5ce568cd6fa894697de5349-522x360.webp",
              _type: "file",
              metadata: {
                width: 522,
                height: 360,
                sha256:
                  "8ad4e46f37cd1f0d72efce67a3be6415458ad146614f17041b24424bff40ff39",
                mimeType: "image/webp",
              },
            },
            image2: {
              _ref: "/public/images/2b5d8a89d9363be1dbf8016b959b43a61edbb594-1274x1092.gif",
              _type: "file",
              metadata: {
                width: 1274,
                height: 1092,
                sha256:
                  "fc6eee47c59162c53e65e5c6de8006b6ec4fce68d2d770d93c061e8098cf13bc",
                mimeType: "image/gif",
              },
            },
          },
          {
            type: "projectQuoteElement",
            author: "Rasmus Hungnes, Natt & Dag",
            quote: "Her blir spillhistorien tatt til sin ytterste konsekvens.",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            side: false,
            size: "sm",
            image: {
              _ref: "/public/images/dfd1831fcfa0cdb4d53bd060c6b6f2f8eae0e366-600x434.gif",
              _type: "file",
              metadata: {
                width: 600,
                height: 434,
                sha256:
                  "9583de1c843c609d7526b0db6df0e7a4e8fda81855acb3bf8c787cb06d64020a",
                mimeType: "image/gif",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  'I spillet styrer man en protagonist ved hjelp av swipe eller piltaster, og målet er å fange så mange coins som mulig (som gir poeng av ulik verdi), og å styre unna blokker i ulik høyde. I bakgrunnen spilles B-Boy Myhres sang "1, 2 step" på repeat. Verdenen strekker seg også uendelig til sidene, best beskrevet av journalisten i ',
                  {
                    tag: "a",
                    href: "https://nattogdag.no/2023/11/statsstottet-kritiker-om-b-boy-myhres-spill-spillhistorien-tatt-til-sin-ytterste-konsekven/",
                    children: ["natt&dag"],
                  },
                  ' “Jeg trykket dobbelt til høyre tror jeg, holdt piltasten inne og forsvant ut mot verdens høyre ende, og jeg kunne se alt. Det hele. Det var ensomt."',
                ],
              },
            ],
            title: "Infinite",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            image: {
              _ref: "/public/images/73a9a0d93b4e54d18422c5b5ea2e002b97e282f6-1280x1515.webp",
              _type: "file",
              metadata: {
                width: 1280,
                height: 1515,
                sha256:
                  "a76e6890d0276f3b245c8b1bb9dc9e787571cbe1cce749ad5a7b13fa9b7bccb7",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "I tillegg til spillet ble det også designet merch. B-Boy Myhre kjørte en instagram-konkurranse hvor de med høyest score i spillet vant hver sin B-Boy Infinite genser.",
                ],
              },
            ],
            title: "Merch",
            side: true,
          },
          {
            type: "textElement",
            title: "",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  {
                    tag: "a",
                    href: "https://bboymyhre.neocities.org/",
                    children: ["Spill B-Boy Infinite her"],
                  },
                  "  ",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "a",
                    href: "https://nattogdag.no/2023/11/statsstottet-kritiker-om-b-boy-myhres-spill-spillhistorien-tatt-til-sin-ytterste-konsekven/",
                    children: ["Les anmeldelsen i Natt og Dag"],
                  },
                  "  ",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "a",
                    href: "https://blogg.blank.no/vi-mekket-et-spill-pÃ¥-3-uker-e82a681b072c",
                    children: ["Bloggpost om å lage et spill på 3 uker"],
                  },
                ],
              },
            ],
          },
          {
            type: "videoElement",
            video: {
              _ref: "/public/videos/e764772d1a513349ef71f0bdba02016045073aa8.mp4",
              _type: "file",
              metadata: {
                sha256:
                  "eb1e9a7af42e54b0ae118990c6dbed6513431efb647ddb1b22c2b3fb750d92d5",
                mimeType: "video/mp4",
              },
            },
          },
          {
            type: "projectTeamElement",
            employees: ["bs", "mth", "zi", "km", "mwb", "mkd"],
            header: "Disse mekket spillet",
          },
        ],
      },
      aneo: {
        colorScheme: {
          backgroundColor: "#000000",
          textColor: "#ffc328",
        },
        content: [
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  'Opprinnelsen til Aneo Mobility kom fra kraftselskapet TrønderEnergi og er et godt eksempel på "Corporate Innovation".  Tjenesten har på få år gått fra en corporate startup til nå en ',
                  {
                    tag: "a",
                    href: "https://en.wikipedia.org/wiki/Scaleup_company",
                    children: ["scaleup"],
                  },
                  ". De har eksperimentert med tjenestetilbud, ulike produktmodeller og leverandører på veien – noe som har ført de til en markedsledende posisjon i sitt segment.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Tjenesten skal levere bekymringsfri og forutsigbar lading for borettslag og sameier, og spenner derfor både borettslagsstyrer og beboere som aktører. Styret ønsker minst mulig administrasjon når en ny beboer ønsker lading, mens beboeren en god opplevelse med tanke på onboarding og bruk.",
                ],
              },
            ],
            title: "Om tjenesten",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/f423ccd475d434c1969719e30702c8a52e8bc477-1208x560.webp",
              _type: "file",
              metadata: {
                width: 1208,
                height: 560,
                sha256:
                  "1ee96be806e0e32ad0095b4ca866e8d1d17012ca7dfe35045a327bc13a601b91",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Aneo Mobility som brand er nytt anno desember 2022, og var før kjent som Ohmia Charging.  I den forbindelse bistod vi med å overføre ny merkevare på digitale og analoge flater. Vi bygget designsystemet for å understøtte designet for flater som selvbetjeningssidene på web, ladeboksene og diverse markedsmatriell.",
                ],
              },
            ],
            title: "Ohmia Charging 👉 Aneo Mobility",
          },
          {
            type: "projectQuoteElement",
            author: "Aneo Mobility",
            quote: "Ikke stress med strømpriser",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            image: {
              _ref: "/public/images/5ffb44e2e3c1e8583ca333064d02542fca746635-580x580.webp",
              _type: "file",
              metadata: {
                width: 580,
                height: 580,
                sha256:
                  "e000feac6682fbb5748f2e0654d7db2124f3284c557e92d0d0abe4a9b05f6114",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "For å kunne bevege seg ut i nye marked, håndtere skalering utover grensene og fortsatt holde kundene fornøyde ble Blank spurt om å bistå med et produktteam for å forvalte og videreutvikle tjenesten. ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Teamet består av både designere og utviklere. Sammen leveres en robust platform for å tåle skaleringen, og mot en bedre brukeropplevelse for Aneos kunder.    ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi var eksempelvis sentrale i arbeidet med å designe og utvikle nye og komplimenterende produkter og etablere alt fra designsystem til migrering til nytt skalerbart CRM-system.",
                ],
              },
            ],
            title: "Hvor kommer vi inn?",
            side: true,
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            side: false,
            image: {
              _ref: "/public/images/0b7514677268decc349a4a464286e2b39d3bb834-580x580.webp",
              _type: "file",
              metadata: {
                width: 580,
                height: 580,
                sha256:
                  "2d78fda37c7ced5f462daf8255588d02e66d039233e7b5ee893bef2d5ad53f76",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  'Ikke alle prosjekter vi deltar i innebærer å leke seg med hardware, eller mer clickbaity skrevet: IoT-dingser. Ettersom Aneo leverer "lading as a service" (-ish), er det fundamentalt at man forstår de ulike støttede ladeboksene og deres leverandører. Blant disse finner man både Easee og Zaptec – to godt kjente norske leverandører. For utviklerne betyr det dypdykk i ulike protokoller og APIer - både fra/til ladeboksene, samt de ulike leverandørenes proprietær HTTP-APIer. HTTP er nok hverdagskost for de fleste kodere, men kanskje ikke OCPP (Open Charge Point Protocol)? Dersom du noen gang har ladet på en offentlig ladeboks, er det sannsynlig at den har ringt hjem ved hjelp av nettopp OCPP over websockets.',
                ],
              },
            ],
            title: "Teknologi",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            image: {
              _ref: "/public/images/c4a5be52f8a9e45b84bac44b56865085877d4d85-416x480.webp",
              _type: "file",
              metadata: {
                width: 416,
                height: 480,
                sha256:
                  "c6fb1bfc6d8e4e44ea71d2677a025868c54766fb70f3ba4fa7e9453333770d05",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Aneo sine kunder har en del funksjonalitet ifra ladeboksene tilgjengelig på Min side, slik som starte og stoppe lading, låse og låse opp ladekabelen. Og naturligvis opp og nedgradere sine ladepakker (abonnement).   ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Her leverte vi en mobiloptimalisert Min side, som ikke bare hadde som formål å være tilpasset mobile flater, men også bedre legge tilrette for opp-, og mersalg av nye produkter og tjenester.",
                ],
              },
            ],
            title: "Optimalisert for mobilvisning",
            side: true,
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Hvis du ønsker å lese mer om Aneo eller Aneo Mobility:",
                ],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          {
                            tag: "a",
                            href: "https://www.aneo.com",
                            children: ["Aneo"],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          {
                            tag: "a",
                            href: "https://www.aneo.com/tjenester/mobility",
                            children: ["Aneo Mobility"],
                          },
                          " ",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          {
                            tag: "a",
                            href: "https://tronderenergi.no/aktuelt#/pressreleases/groent-lys-for-aneo-3190715",
                            children: ["Presse (Aneo etableres)"],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          {
                            tag: "a",
                            href: "undefined",
                            children: ["Hvordan fungerer lading hos Aneo"],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Mer lesning",
          },
          {
            type: "projectTeamElement",
            employees: ["ajj", "tu", "amalie", "lls", "lig", "johnk"],
            header: "Fra Blank",
          },
        ],
        hero: {
          description:
            "Aneo Mobility er Norges største leverandør av elbillading til borettslag og sameier.",
          image: {
            _ref: "/public/images/c5d52e60a0641b706ce8f7aa4f90773b851b26db-1208x560.webp",
            _type: "file",
            metadata: {
              width: 1208,
              height: 560,
              sha256:
                "f6a60c10c0878adaeba620be584517c46d19dc6c27968edd979f591c46ed7e1b",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            description: null,
            client: "Aneo Mobility",
            contribution:
              "UX og Interaksjonsdesign, sky-migrering, integrasjon, selvbetjening",
          },
          shortDescription:
            "Norges største leverandør av elbillading til borettslag og sameier.",
          title: "Aneo Mobility",
        },
        order: 3,
      },
      hjemmelegene: {
        colorScheme: {
          backgroundColor: "#f5f5f5",
          textColor: "#000000",
        },
        content: [
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/d1449251c4adf45f7fcead9a6a8bd169b7548d15-2500x1667.webp",
              _type: "file",
              metadata: {
                width: 2500,
                height: 1667,
                sha256:
                  "d57b88ecf1477d128790e9b47441b97e75467993ffce2b71082eb07d3ddfb027",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Hjemmelegene er en helhetlig helsetjeneste med mål om å skape et nært og godt møte mellom pasient og helsepersonell. I 2017 etablerte de seg med å tilby legebesøk hjemme, støttet av en digital plattform. I dag tilbyr de flere helsetjenester både hjemme, på arbeidsplasser og klinikker.",
                ],
              },
            ],
            title: "Bakgrunn",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Etter etableringen har løsningene og behovene blitt stadig mer komplekse. Hjemmelegene ønsket derfor å ta grep for å skape en god, helhetlig opplevelse i nye kundereiser og på tvers av fysiske og digitale kontaktflater.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi har i denne forbindelse bistått med å etablere og lede arbeidet med UX og tjenestedesign internt og jobbet integrert i Hjemmelegenes produktorganisasjon.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi var involvert i både forbedringer og nyutvikling av Hjemmelegenes digitale interne og pasientrettede produkter.",
                ],
              },
            ],
            title: "UX og tjenestedesign",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/f636aadb9b8f76fc709ac047271c47ed3704e8a1-2500x1667.webp",
              _type: "file",
              metadata: {
                width: 2500,
                height: 1667,
                sha256:
                  "b80d59a413298c415960b33f61388657dd5e27e37f5db67e3e456ef1dd0b0138",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            image: {
              _ref: "/public/images/ef5a60cc666087db87e6a61234179e5d0590eb59-3456x2234.webp",
              _type: "file",
              metadata: {
                width: 3456,
                height: 2234,
                sha256:
                  "ef0c96d752784aea10a2cd99e2bf14b867c334b131f9533bce2fda5afbe3f0a8",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Vi designet en ny løsning for digitale konsultasjoner over video, chat og telefon, en tjeneste både for pasienter og for legene som behandler de.",
                ],
              },
            ],
            title: "Digitale konsultasjoner",
            side: true,
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            side: false,
            image: {
              _ref: "/public/images/0311ea05506ca31cbea7fcd0f87299d23648169f-2048x1365.webp",
              _type: "file",
              metadata: {
                width: 2048,
                height: 1365,
                sha256:
                  "82d7e85f6ab40b9b931e28a6f7bf5c3386e759a8309670750633e9d6bfddbeb2",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Vi jobbet også med tjenestedesign og brukeropplevelse for Hjemmelegenes nye satsningsområde innenfor medtail, sykepleierklinikker som tilbyr helsetjenester i kombinasjon med detaljhandel.",
                ],
              },
            ],
            title: "Klinikk i butikk",
          },
          {
            type: "projectTeamElement",
            employees: ["TBN"],
            header: "Fra Blank",
          },
        ],
        hero: {
          description:
            "Design for Hjemmelegene, en helhetlig tjeneste med mål om å skape et nært og godt møte mellom pasient og helsepersonell.",
          image: {
            _ref: "/public/images/f5cf982eed5f9146de37aba5af543d1f03ba3b06-2779x1563.webp",
            _type: "file",
            metadata: {
              width: 2779,
              height: 1563,
              sha256:
                "9deccbe377aa678dacc3815b87194b61f4be49f756e0f73ea4b635f47d8d8365",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            description: null,
            client: "Hjemmelegene",
            contribution: "Tjenestedesign og UX design",
          },
          shortDescription:
            "Designe et nært og godt møte mellom pasient og helsepersonell.",
          title: "Hjemmelegene",
        },
        order: 4,
      },
      finn: {
        colorScheme: {
          backgroundColor: "#13233B",
          textColor: "#FFFFFF",
        },
        content: [
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            side: false,
            image: {
              _ref: "/public/images/38b324b0451149f52a078e06c38048c9493c3efd-1334x782.webp",
              _type: "file",
              metadata: {
                width: 1334,
                height: 782,
                sha256:
                  "727dc218c2379ee7d86b1676334611ae4c4d4d0b49f0f661f42614c2f25d46b0",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Det har blitt vanskeligere å tjene penger i bruktbilbransjen de siste årene. Markedet er i endring, det er små marginer og det finnes begrensede kilder til innsikt for å ta gode strategiske beslutninger.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Data er etterspurt og FINN.no har tilliten, kompetansen, relasjonene og ressursene til å bygge et innsiktsverktøy som svarer på bransjens behov og problemstillinger.",
                ],
              },
            ],
            title: "Bakgrunn",
          },
          {
            type: "projectQuoteElement",
            author: "Magnus Groseth, daglig leder hos bilforhandleren KBIL",
            quote:
              "Det ligger ekstremt mye kunnskap i dette verktøyet. Rett og slett et genialt produkt som gjør det enda enklere å ta inn riktige biler.",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/5eda7833d1b59cfa1fc1b6faca7723759a813b1a-6061x4041.webp",
              _type: "file",
              metadata: {
                width: 6061,
                height: 4041,
                sha256:
                  "b565124a2df4083d1dba22a8a8a0a39e16e9bd74e25370dfbb473b686834cb1c",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "For å hjelpe bruktbilforhandlerne med sine utfordringer har FINN.no lansert en tjeneste, et abonnementsbasert innsiktsverktøy, som nå står klart til å hjelpe mer enn 2600 bilforhandlere og andre tilstøtende bedrifter i hele landet. Ved å gjøre data fra FINN.no tilgjengelig og forståelig kan vi hjelpe bilforhandlerne til å jobbe mer datadrevet, og dermed bli mer effektive og lønnsomme i deres arbeidshverdag.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Eksempler på innsikt bilforhandlerne kan finne er; hvor lenge ligger en bil ute på FINN før den blir solgt? Hvilke biler bør man satse på? Og hvilken pris kan man ta?  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "I tett samarbeid med hele bruktbilbransjen, startet et tverrfagelig team med å konkretisere behov og utforske hvordan en potensiell løsning kan bli. Det startet som en slags intern start up med et lite team på tre personer som utforsket om det var liv laga. I dag er det et større team som drifter og itererer på verktøyet samtidig som det rulles ut i markedet.",
                ],
              },
            ],
            title: "Diagnoseporten fra FINN.no",
          },
          {
            type: "projectQuoteElement",
            author: "Magnus Groseth, daglig leder hos bilforhandleren KBIL",
            quote: "Alle som jobber hos KBIL bruker det hver eneste dag!",
          },
          {
            type: "doubleImageElement",
            alt: "",
            clickable: false,
            size: "lg",
            image1: {
              _ref: "/public/images/ff0c0b822cdd251a7afc763e8c0da64a6000dc32-1600x900.webp",
              _type: "file",
              metadata: {
                width: 1600,
                height: 900,
                sha256:
                  "1bec512d996f7f546235b27614f32d913a51032e633e3f400892b9a8ecf6c556",
                mimeType: "image/webp",
              },
            },
            image2: {
              _ref: "/public/images/dc96840022d63dd23a965f68412a6cec3b131f61-824x731.webp",
              _type: "file",
              metadata: {
                width: 824,
                height: 731,
                sha256:
                  "e0daf689fc92b650f2a17da0f9b97ea01cf70499f4c51a9679ba3450b4b4fa5c",
                mimeType: "image/webp",
              },
            },
          },
          {
            type: "projectTeamElement",
            employees: ["un"],
            header: "Fra Blank",
          },
        ],
        hero: {
          description:
            "Diagnoseporten fra FINN — en unik oversikt over dagens bruktbilmarked og hvordan det utvikler seg.",
          image: {
            _ref: "/public/images/97a537b96766fe250b45f3e32574565f13af3a84-5184x3456.webp",
            _type: "file",
            metadata: {
              width: 5184,
              height: 3456,
              sha256:
                "0cc5f9870ac85deb72c969d6e0ef29ac9edfbb0a056a933db49413efae103aba",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            description: null,
            client: "FINN.no",
            collaborators:
              "Team Innsikt som produkt og UX-avdelingen i FINN.no",
            contribution:
              "Laget en tjeneste for bilbransjen med innsikt om bruktbilmarkedet",
          },
          shortDescription:
            "Diagnoseporten — unik oversikt over dagens bruktbilmarked og hvordan det utvikler seg.",
          title: "FINN.no",
        },
        order: 5,
      },
      ice: {
        colorScheme: {
          backgroundColor: "#585449",
          textColor: "#ffffff",
        },
        content: [
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/508f12fd0efd6180dff42e70a0e9139fe7916dcb-2560x1514.webp",
              _type: "file",
              metadata: {
                width: 2560,
                height: 1514,
                sha256:
                  "f8457d8c8ed2aefe91ffd68ef652111c7570e78a5a52f82682a5b9027d0b1992",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "UX og UI-design, konseptutvikling 2019-2020.",
                  {
                    tag: "br",
                  },
                  "Ice har vunnet mange priser for sin fremragende kundeservice. Verktøyet kunderserviceagentene bruker heter Manny. Blank var med fra start.",
                ],
              },
            ],
            title: "Manny",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/066bc7b4493f8b49f179486faa3f286c1926c436-3000x2000.webp",
              _type: "file",
              metadata: {
                width: 3000,
                height: 2000,
                sha256:
                  "739622243e36af9c7ba7056d69fee629982668aa4a7246360c5bf58ff23cc848",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "UX og UI-design 2019-2021.",
                  {
                    tag: "br",
                  },
                  "Når en selger i en av ice sine egne butikker eller hos forhandlere som Power eller Elkjøp selger en telefon med et ice-abonnement, gjennomføres salget i Diego. Blank har stått for UX og UI-design.",
                ],
              },
            ],
            title: "Diego",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/828fc731d030428a95b271cb3266882d8b051b09-1204x567.webp",
              _type: "file",
              metadata: {
                width: 1204,
                height: 567,
                sha256:
                  "75dd213521088fbfb10a98cdef96139c3813506317661412ee9304baab7db421",
                mimeType: "image/webp",
                hotspot: {
                  x: 0.9465408805031447,
                  y: 0.05342237061769616,
                  width: 1,
                  height: 1,
                },
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "UX design - 2019- 2020",
                  {
                    tag: "br",
                  },
                  "Mobilbytte var en innovasjon da det ble lansert i 20XX. Det tillot kundene å kjøpe telefon med en forsikring inkludert i prisen som gjør at de kan bytte telefon etter 18 måneder.",
                ],
              },
            ],
            title: "Mobilbytte",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/e02be2dbd72e050536c523935e194c59c68d6042-1650x940.webp",
              _type: "file",
              metadata: {
                width: 1650,
                height: 940,
                sha256:
                  "3d5e3f44daa8ede1f34348e1ce3530b28321b0f6438d05fb2cd6f889c53d5db5",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "UX/UI design - 2021-2022",
                  {
                    tag: "br",
                  },
                  "Ice satser hardt i bedriftsmarkedet, og Blank er med på ombygging og oppussing av Min Bedrift.",
                ],
              },
            ],
            title: "B2B",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/63be5840c0f79b1ba929fe6346188d8f0579560b-1920x1080.webp",
              _type: "file",
              metadata: {
                width: 1920,
                height: 1080,
                sha256:
                  "ad6676f01f62306c77c0951a9a44954a6a35168fe5643b7ba8a271dd0d47b9d7",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "UX/UI-design, 2021",
                  {
                    tag: "br",
                  },
                  "Ice har alltid hatt gode produkter for familien. Med iceFamilie ga vi alle som samlet familien hos ice enda flere kundefordeler.",
                ],
              },
            ],
            title: "iceFamilie",
          },
          {
            type: "projectTeamElement",
            employees: [
              "jbo",
              "lee",
              "amalie",
              "mwb",
              "øj",
              "johnk",
              "oj",
              "iem",
              "tu",
              "sys",
            ],
            header: "Folka",
          },
        ],
        hero: {
          description:
            "Her er et knippe små og store ting vi har lagd sammen med flinke folk i Norges hyggeligste mobilselskap, ice, en betrodd blank-kunde siden 2015.",
          image: {
            _ref: "/public/images/8d4fb003f04424547fdd2418551cfdc54c1f363d-1180x567.webp",
            _type: "file",
            metadata: {
              width: 1180,
              height: 567,
              sha256:
                "db07e8661e6c53fef382957a2a4a9d529f66f38d15d0ee21d8afc464644142d2",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            client: "ice",
            collaborators: "ice, diverse folk fra Blank.",
            contribution:
              "Design, innsikt, analyse, konsept, testing og utvikling",
            description:
              "Helt siden ice lanserte mobiltelefoni og startet utbygging av mobilnettet sitt har de hatt ett mål for øyet — å utfordre og forbedre det norske mobilmarkedet. Gjennom de første syv årene som mobiloperatør gikk de fra én kunde og én mobilmast, til over 700 000 kunder.",
          },
          shortDescription:
            "Små og store ting vi har lagd sammen med flinke folk i Norges hyggeligste mobilselskap, ice.",
          title: "ice",
        },
        order: 6,
      },
      morgenlevering: {
        colorScheme: {
          backgroundColor: "#fffdf5",
          textColor: "#1b3732",
        },
        content: [
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Det er en terskel å bestille hjemlevering til noen andre enn seg selv. Det innebærer at mottaker må være hjemme innenfor et gitt tidspunkt. Her skiller Morgenlevering seg ut, de benytter seg av avisbudene for å levere ferskt bakst og gaver sammen med avisa, helt frem til dørmatta. Uten kontakt. Nyttig under korona. Dette gjør Morgenlevering til en perfekt tjeneste for gaver – har du bestilt en Morgenlevering trenger du ikke å vite om gavemottakeren er hjemme mellom klokka 14–19. Så lenge de våkner hjemme, våkner de til en melding om en gave på dørmatten. ",
                  {
                    tag: "span",
                    styles: ["italic"],
                    children: ["Litt julenissefaktor."],
                  },
                ],
              },
            ],
            title: "Unik markedsposisjon",
          },
          {
            type: "doubleImageElement",
            alt: "",
            clickable: false,
            size: "lg",
            image1: {
              _ref: "/public/images/b7f3899f8b9edd5797e167e7c0156bc35db99bfc-1600x960.webp",
              _type: "file",
              metadata: {
                width: 1600,
                height: 960,
                sha256:
                  "d4530676f96e07df5e2f290be22c60d709571449dbf84799d5da70f8797248c3",
                mimeType: "image/webp",
              },
            },
            image2: {
              _ref: "/public/images/8cd86c4ad115ab1216801bc384ea19e8c5f19519-1600x960.webp",
              _type: "file",
              metadata: {
                width: 1600,
                height: 960,
                sha256:
                  "9ac490536b2ccee173db5b521ae9097f750f96d1962d9568ff75f2fd0e8e5ca8",
                mimeType: "image/webp",
              },
            },
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Den første jobben var å automatisere en del interne arbeidsoppgaver som tok mye tid fra enkelte ansatte – flere personer satt oppe sent hver eneste dag for å manuelt “stenge butikken” for bestillinger når Morgenlevering ikke hadde flere frokoster er å sende ut. Dette ordnet vi – så i dag kan alle ta helg uten bekymring.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi benyttet muligheten til å freshe opp designet og rydde opp i en del problemer knyttet til tilgjenglighet og brukeropplevelse av tjenesten, både på løsningen ut mot kunde, men også internt på strategisk og distribusjonsnivå.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Videre flyttet vi Morgenlevering over til Sanity, og ryddet opp i både design og kode for å bygge felles komponenter som er gjenbrukbare.",
                ],
              },
            ],
            title: "Resultat",
          },
          {
            type: "projectTeamElement",
            employees: [
              "tø",
              '"Han som knekker fisk"',
              "emilie",
              "amalie",
              "isak",
              "anja",
            ],
            header: "Disse ordnet frokost",
          },
        ],
        hero: {
          description: "Fersk frokost levert på døren før du står opp.",
          image: {
            _ref: "/public/images/cb1f16bd603099334b8fe5588dc3f251efb6237a-2372x1112.webp",
            _type: "file",
            metadata: {
              width: 2372,
              height: 1112,
              sha256:
                "baaab1d4a6e99381b4192d4818be95476924bd59bd612c70f9b263a54088d53f",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            client: "Morgenlevering.no",
            contribution: "Utvikling og UX-, UI og tjenestedesign.",
            description:
              "Morgenlevering har gått fra å være en liten start-up til å bli en svært populær tjeneste de siste to årene. Når vi alle sammen satt hjemme i 2020-22 og ikke lenger hadde mulighet til å besøke venner, arrangere bursdager eller ta ekstra lange lunsjer med jobben ble Morgenlevering svaret. Å gi en Morgenlevering i gave til gode venner, kollegaer og familie ble for mange en fin erstatning. Den økte etterspørselen førte til flere utfordringer for Morgenlevering, da de opplevde at systemene deres ikke var rigget for å håndtere tredobblingen av bestillinger. Blank ble kontaktet og vi sendte inn et team bestående av designere og utviklere.",
          },
          shortDescription: "Fersk frokost levert på døren før du står opp.",
          title: "Morgenlevering",
        },
        order: 2,
      },
      remarkable: {
        order: 7,
        colorScheme: {
          backgroundColor: "#f2eeea",
          textColor: "#000000",
        },
        content: [
          {
            type: "projectQuoteElement",
            author: "Øyvind",
            quote:
              "reMarkable gir deg mulighet til å organisere og arkivere notater og tegninger digitalt samtidig som du får friheten til å fokusere på kreativiteten og ideene — i stedet for å bli distrahert av teknologi.",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/905287bc44898e96b9d9364f12a8f84ce385bf92-6240x4160.webp",
              _type: "file",
              metadata: {
                width: 6240,
                height: 4160,
                sha256:
                  "f9a2df5e5a67d7be4f1f14f0a2b43f5e74582e7bfe0a4f9b9d64bca9db6e8b33",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Siden 2016 har vi hatt et tett samarbeid med reMarkable. Det første vi jobbet med hos reMarkable var design av brukergrensesnittet på tegne- og skrivebrettet. Her jobbet vi med både grunnleggende interaksjonsdesign i operativsystemet, ikonografi, navigasjon og menystruktur. ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi har også bidratt i arbeidet med håndskriftkonvertering, maler og utvikling av tilhørende tjenester i reMarkable sin mobil-app.",
                ],
              },
            ],
            title: "Dette har vi jobbet med ",
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            image: {
              _ref: "/public/images/1bee88afe3844358cba29ae41753869d843ad358-6240x4160.webp",
              _type: "file",
              metadata: {
                width: 6240,
                height: 4160,
                sha256:
                  "96a847b8dec08a02726502223e3b55dbf47a12ac97e55dd33af00607830b8ab6",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Blank har også hatt flere utviklere og designere i ulike team på reMarkable som har jobbet på store deler av reMarkables nettside og nettsidens tilhørende tjenester. Her har vi jobbet med alt fra kampanjer og cms (content management systems), til støtte for ulike land og valutaer og integrasjon mot betalingsplattformer.",
                ],
              },
            ],
            title: "Nettsiden",
            side: true,
          },
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            size: "sm",
            side: false,
            image: {
              _ref: "/public/images/ef970d9d541bbf390a41b393727d08909b30dbbe-6240x4160.webp",
              _type: "file",
              metadata: {
                width: 6240,
                height: 4160,
                sha256:
                  "4c6ea1cbd113e73c32bf08cb84f927a7847fed870ff48efa5b036e02ee3a43c3",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Etter lansering av reMarkable 2 og abonnementløsningen Connect har vi bidratt med salg og selvbetjeningsløsninger. I hovedsak på ",
                  {
                    tag: "a",
                    href: "http://remarkable.com",
                    children: ["remarkable.com"],
                  },
                  " og ",
                  {
                    tag: "a",
                    href: "http://my.remarkable.com",
                    children: ["my.remarkable.com"],
                  },
                  ".   ",
                ],
              },
              {
                tag: "p",
                children: [
                  "På my.remarkable.com kan brukere laste ned apper og koble seg opp mot ulike tjenester i økosystemet til reMarkable, samt håndtere abonnementet.",
                ],
              },
            ],
            title: "My reMarkable",
          },
          {
            type: "projectTeamElement",
            employees: ["svg", "mkd", "mb", "emilie", "fe", "øj"],
            header: "Fra Blank",
          },
        ],
        hero: {
          description:
            "Digitalt skrive- og tegnebrett som gir følelsen av å skrive på vanlig papir",
          image: {
            _ref: "/public/images/2cef3d87fca4e4817d4b0f385ced96b3cb9742b5-6240x4160.webp",
            _type: "file",
            metadata: {
              width: 6240,
              height: 4160,
              sha256:
                "eee099538dca794b384dda64f7b3e6047536a350e791c7c30375895136ba83f9",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            collaborators: null,
            client: "reMarkable",
            contribution: "Design og utvikling",
            description:
              "For få år siden var reMarkable en liten start-up i Oslo i en ikke-eksisterende nisje i markedet. I dag har reMarkable utviklet seg til et selskap som hevder seg på det globale markedet og hisser på seg store aktører som Amazon og Lenovo. Til tross for flere konkurrerende produkter beholder reMarkable posisjonen som det ledende produktet i markedet.",
          },
          shortDescription:
            "Digitalt skrive- og tegnebrett som gir følelsen av å skrive på vanlig papir",
          title: "reMarkable",
        },
      },
      "reisen-til-spektrum": {
        colorScheme: {
          backgroundColor: "#FAFCFF",
          textColor: "#000000",
        },
        content: [
          {
            author: "Sondre Justad (Aftenposten Magasinet)",
            quote:
              "Dette skal være en måte vi blir kjent med hverandre på før vi møtes i Oslo Spektrum. ",
            type: "projectQuoteElement",
          },
          {
            type: "singleImageElement",
            image: {
              _ref: "/public/images/89abbed5309cef2d8b8fcc745955adfafdb2163f-800x600.webp",
              _type: "file",
              metadata: {
                width: 800,
                height: 600,
                sha256:
                  "608f71db3bd7e158d25f136391fac2209e63b696d855ca9f6917e527e0405224",
                mimeType: "image/webp",
              },
            },
            alt: "Sondre Justad",
            clickable: false,
            keepAspectRatio: true,
            size: "md",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Det hele starter med Victoria — Sondres største fan. Hun får personlig overlevert en invitasjon fra ham, og får beskjed om å invitere fem andre dette vil bety noe for. De får i tur invitere fem andre, som får invitere fem andre og så videre, og så videre.",
                ],
              },
            ],
            title: "Hviskeleken",
          },
          {
            type: "textAndImageElement",
            alt: "Utsolgt",
            clickable: false,
            side: false,
            size: "sm",
            image: {
              _ref: "/public/images/a6acb5ec08eccde41c8b0b9491167c290c06d9e9-360x288.gif",
              _type: "file",
              metadata: {
                width: 360,
                height: 288,
                sha256:
                  "36687982a6c27b7579af8765e9113984ceceb4dce2428954ab5afd36ec7105e5",
                mimeType: "image/gif",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "Organisk vekst er vanskelig og uforutsigbart, men invitasjonene begynner å spre seg. ",
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Etter ca 199 dager blir konserten utsolgt"],
                  },
                  ", uten noe hjelp av media eller tradisjonelle kanaler, kun ved hjelp av invitasjons-konseptet og Sondres fans.",
                ],
              },
            ],
            title: "Utsolgt",
          },
          {
            type: "projectQuoteElement",
            author: "Juryen, Visueltprisen",
            quote:
              "Forventningen og oppbyggingen til konserten blir forsterket gjennom en integrert digital opplevelse på tvers av flater",
          },
          {
            type: "singleImageElement",
            alt: "Fra Tøyen til Spektrum",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/67e7ab297bb04ad64d1edab83eb65a053b9854db-801x600.webp",
              _type: "file",
              metadata: {
                width: 801,
                height: 600,
                sha256:
                  "29b07f5ca34829ea337dbc7d858db0408d3349a49e191ae39a611cf7a6f436d4",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Reisen til Spektrum er en helt ny opplevelse av billettkjøp som skaper en personlig nærhet til artisten og en følelse av fellesskap mellom artist og fans.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Reisen til Spektrum foregår i et digitalt kart fra Sondre sin egen leilighet på Tøyen, gjennom Grønland og til Oslo Spektrum. Her kan de som har billett få tilgang til eksklusivt innhold, og bli invitert til arrangementer både fysisk og digitalt. Justad har blant annet sluppet sanger fra sitt nye album i løsningen før offisiell lansering.",
                ],
              },
            ],
            title: "Fra Tøyen til Spektrum",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/e7538b825016e9197633c03998b2b6e39790b63f-1400x491.webp",
              _type: "file",
              metadata: {
                width: 1400,
                height: 491,
                sha256:
                  "dfdb89923061a1df0ed01aa449ab6d5c3eed40b43cf591bc90c2914e24ac7494",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/a07c68c3aa07e3886698f36e470961e6a9811539-200x200.gif",
              _type: "file",
              metadata: {
                width: 200,
                height: 200,
                sha256:
                  "821ce5b49b3aac87256e6f1ac9d63e200a81a8c21951609ef502c3cad5fbed63",
                mimeType: "image/gif",
              },
            },
            size: "xs",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Løsningen er gjenbrukbar, men er også skreddersydd for Sondre Justad som artist og hans visuelle profil. Arbeidet er utført i god dialog med Justad sitt designteam bestående av Sondre Røe og Kristoffer Eidsnes.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Løsningen fikk Gull i Gulltaggen og Gull i Visuelt.",
                ],
              },
            ],
            title: "Gjenbrukbar løsning",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
              _type: "file",
              metadata: {
                width: 1920,
                height: 1281,
                sha256:
                  "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
                mimeType: "image/webp",
              },
            },
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: [
                      "italic",
                      null,
                      "bold",
                      null,
                      null,
                      "bold",
                      null,
                      null,
                      "bold",
                      null,
                      null,
                      null,
                    ],
                    children: [
                      "https://www.aftenposten.no/amagasinet/i/z7yRyw/sondre-justad-aapnet-seg-da-alt-stengte ",
                      "https://730.no/sondre-justad-solgte-ut-hemmelig-oslo-spektrum-konsert/ ",
                      "https://www.lofot-tidende.no/sondre-har-solgt-ut-oslo-spektrum-maten-han-gjorde-det-pa-var-ganske-spesiell-er-det-en-drom-eller-er-det-pa-ekte/s/5-28-351032 ",
                      "https://www.lofotposten.no/na-gjor-sondre-noe-han-aldri-har-gjort-for-jeg-drives-av-a-komme-tett-pa-andre-mennesker/s/5-29-759369 ",
                      "https://tv.nrk.no/serie/dagsrevyen/202111/NNFA19110821/avspiller#t=32m55s",
                      "https://radio.nrk.no/serie/nyhetsmorgen/sesong/202111/NPUB32022121#t=1h15m18s",
                      "https://www.fremover.no/ingen-fikk-vite-om-konserten-men-sondre-justad-solgte-den-helt-ut/s/5-17-916706 ",
                      "__",
                      "https://play.tv2.no/nyheter/nyhetene/gode-nyheter/gode-nyheter-2021-episode-367-1692000.html?showPlayer=true",
                    ],
                  },
                ],
              },
            ],
            title: "Presseoppslag",
          },
          {
            type: "multipleImageElement",
            images: [
              {
                _ref: "/public/images/1388d5e8dcedaecd8fa742801fccf5a941ec9027-500x500.gif",
                _type: "file",
                metadata: {
                  width: 500,
                  height: 500,
                  sha256:
                    "9e75f8eec87b99838c1560da8bff7cc694ba2a1c436cd157a0e45ca658ad6784",
                  mimeType: "image/gif",
                },
              },
              {
                _ref: "/public/images/81f6d9ea839d43cdf33e93e5941d6a3f51adfa64-200x200.gif",
                _type: "file",
                metadata: {
                  width: 200,
                  height: 200,
                  sha256:
                    "1e5ebc491ca05db5c3dd8a9493439d9c6a33493f696b8836bd51e1f21d172e1b",
                  mimeType: "image/gif",
                },
              },
              {
                _ref: "/public/images/e681a521074a4ec862c9c4ce2388c00c3b7e4a41-200x200.gif",
                _type: "file",
                metadata: {
                  width: 200,
                  height: 200,
                  sha256:
                    "45b24eb4db757c2cb07b75e89bdb3ab24114c32d9ddb65f922faf4f4a6fd8d3e",
                  mimeType: "image/gif",
                },
              },
            ],
          },
          {
            type: "projectTeamElement",
            employees: ["amalie", "eå", "mkd"],
            header: "Fra Blank",
          },
        ],
        hero: {
          description:
            "Hvordan Sondre Justad solgte ut Oslo Spektrum i all hemmelighet.",
          image: {
            _ref: "/public/images/614d310668749f39c2e4fec8c784fa728fc59a56-2560x1440.webp",
            _type: "file",
            metadata: {
              width: 2560,
              height: 1440,
              sha256:
                "f66888b3cc45d2c0ceacd6ea8f9c2f8847203848a8d2cc8faaa402a753299d5f",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            client: "Sondre Justad",
            collaborators: "Sondre Justad, Sesong 1, Beyond Management & ANTI",
            contribution: "Konseptutvikling, design og utvikling",
            description:
              "Sondre Justad skal spille konsert i Oslo Spektrum for første gang i sin karriere. Han ønsker å bygge noe større sammen med fansen, dyrke fellesskapet og tilhørigheten de sammen opplever gjennom musikken. Justad og fansen skal sammen delta på “Reisen til Spektrum”, og konserten i Spektrum skal først bli offentliggjort når alle billettene er utsolgt.",
          },
          shortDescription:
            "Hvordan Sondre Justad solgte ut Oslo Spektrum i all hemmelighet.",
          title: "Reisen til Spektrum",
        },
        order: 8,
      },
      amoi: {
        colorScheme: {
          backgroundColor: "#0C3A45",
          textColor: "#E9F2F1",
        },
        content: [
          {
            type: "videoElement",
            video: {
              _ref: "/public/videos/AMOI_Hero.mp4",
              _type: "file",
              metadata: {
                sha256:
                  "d8c2df57dfba2a235a238ba54cc157f30393cb5dfae63b8c75b16c266c7cf1e3",
                mimeType: "video/mp4",
              },
            },
          },
          {
            type: "projectQuoteElement",
            author: "Gulltaggen Jury",
            quote:
              "Amoi har klart å skape en varm følelse av den lokale nabobutikken med god kvalitet. \n\nAlt oser kvalitet, det å oppnå dette i en stor og tung organisasjon er nytenkende, modig og ikke minst svært imponerende.",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/fa3de4c4513a19b133e82b78959a5101517abfed-3000x2000.webp",
              _type: "file",
              metadata: {
                width: 3000,
                height: 2000,
                sha256:
                  "3c267598e0acc1ffd122262ba0ab276d7114f2b8704638d1ae3d30d0e21ba045",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Amoi er en tjeneste som gjør det enklere for kunder å handle kvalitetsvarer fra Oslos beste leverandører, og få dem levert hjem til døren. Kunden bestiller varer på AMOI.no, posten plukker opp varene hos leverandøren og leverer dem hjem til kunden i løpet av få timer. Man kan bestille varer opptil 6 dager i forveien av ønsket leveringstidspunkt.",
                ],
              },
            ],
            title: "Bakgrunn",
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            image: {
              _ref: "/public/images/647d531455024f5a6db16f998fb4304e097838ef-3000x2000.webp",
              _type: "file",
              metadata: {
                width: 3000,
                height: 2000,
                sha256:
                  "49c5f74ba9956505689a105d960ec86046db50fee16665bdda499fabcab86aec",
                mimeType: "image/webp",
              },
            },
            keepAspectRatio: true,
            size: "lg",
          },
          {
            type: "textElement",
            size: "sm",
            title: "",
            text: [
              {
                tag: "p",
                children: [
                  "Med AMOI kan man fylle opp handlekurven med kvalitetsvarer fra byens beste butikker og produsenter; bukett fra en blomsterbutikk, øl fra bryggeri, kjøtt fra slakteren, brød fra bakeriet, og kaffe rett fra brenneriet. Amoi skaper denne synergien, som gir verdi både for leverandørene og for kunden.",
                ],
              },
            ],
          },
          {
            type: "singleImageElement",
            alt: "",
            clickable: false,
            keepAspectRatio: false,
            image: {
              _ref: "/public/images/453f9ea3a47f9fbb6ac73dbb3b147516c8f5ef6e-1080x1080.webp",
              _type: "file",
              metadata: {
                width: 1080,
                height: 1080,
                sha256:
                  "fdee9f1ab55c2f80b96ec33a543bf0ed9a72ba81006d8ebfbdb43c5efa631d00",
                mimeType: "image/webp",
              },
            },
            size: "md",
          },
          {
            type: "textElement",
            size: "sm",
            title: "",
            text: [
              {
                tag: "p",
                children: [
                  "Ved å fokusere på leverandører i lokalsamfunnet, styrker Amoi lokal konkurransedyktighet samtidig som de bidrar til å støtte et bærekraftig lokalsamfunn. I tillegg gir det kunder tilgang til gode varer på en veldig enkel måte.",
                ],
              },
            ],
          },
          {
            type: "doubleImageElement",
            alt: "",
            clickable: false,
            size: "lg",
            image1: {
              _ref: "/public/images/272c3b5634e993957f1caadfe040731811b06cf6-1080x1080.webp",
              _type: "file",
              metadata: {
                width: 1080,
                height: 1080,
                sha256:
                  "f40445ce636821fd7039b06fda99ea9a73585f542249291c1106dbb7177b8267",
                mimeType: "image/webp",
              },
            },
            image2: {
              _ref: "/public/images/2194ca4fa3e02519a4fb0b56c7f22b478f548da6-1080x1080.webp",
              _type: "file",
              metadata: {
                width: 1080,
                height: 1080,
                sha256:
                  "57f5fea57ee17e8bb6e7a55a21590edf9a5bef00cfdae8030b873fa8ceb646cd",
                mimeType: "image/webp",
              },
            },
          },
          {
            type: "projectTeamElement",
            employees: ["lee", "mwb"],
            header: "Disse løste biffen",
          },
        ],
        hero: {
          description:
            "AMOI er en samlet markedsplass med tilbud fra ulike lokale butikker og tjenester i Oslo. Du bestiller fra flere butikker samtidig og får det lynraskt levert hjem til deg.",
          image: {
            _ref: "/public/images/fa3de4c4513a19b133e82b78959a5101517abfed-3000x2000.webp",
            _type: "file",
            metadata: {
              width: 3000,
              height: 2000,
              sha256:
                "3c267598e0acc1ffd122262ba0ab276d7114f2b8704638d1ae3d30d0e21ba045",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            description: null,
            client: "Posten, AMOI",
            collaborators: "Postens innovasjonsmiljø",
            contribution:
              "Brand- og designsystem, UX-, UI- og tjenestedesign, IA, art direction av film og fotografi, illustrasjon, grafisk design",
          },
          shortDescription:
            "Markedsplass med tilbud håndplukket fra byens beste butikker.",
          title: "Amoi",
        },
        order: 9,
      },
      "sas-skien": {
        colorScheme: {
          backgroundColor: "#000000",
          textColor: "#ffffff",
        },
        content: [
          {
            type: "textAndImageElement",
            alt: "",
            clickable: false,
            side: false,
            size: "sm",
            image: {
              _ref: "/public/images/c00c7f4c90d2498aa2e54b4f0c603d8de601e584-3360x1860.webp",
              _type: "file",
              metadata: {
                width: 3360,
                height: 1860,
                sha256:
                  "5b24026b0825a7a915b9518f81b290a0e2d61ee5c2612c4e33499fc76f5b2a2e",
                mimeType: "image/webp",
              },
            },
            text: [
              {
                tag: "p",
                children: [
                  "I 2020 skulle Karpe holde fem forestillinger i Festiviteten i Skien for 100 spesielt inviterte fans.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "For å bli plukket ut til SAS Skien måtte du melde deg på gjennom sasskien.no. Fordi nettsiden både er en påmeldingsløsning og en del av opplevelsen benyttes lyd, video og 3D-animasjon (WebGL) for å skape en helt distinkt stemning.",
                ],
              },
            ],
            title: "100 spesielt inviterte",
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "sasskien.no bygger videre på 90-tallsestetikken i SPSP-universet, men i takt med at spørsmålene blir mer og mer kryptiske knekker løsningen, fasaden går gradvis i oppløsning og du blir trukket ned i en alternativ og mørkere virkelighet under overflaten.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Det er en løsning som skaper engasjement og som oppleves som litt merkelig, litt skummel og som trigger både forventning og undring hos fansen.",
                ],
              },
            ],
            title: "SAS Pussy SAS Plus",
          },
          {
            type: "multipleImageElement",
            images: [
              {
                _ref: "/public/images/6c8e99a7f4a848003658e8a15dbd431cd14b33d2-320x546.gif",
                _type: "file",
                metadata: {
                  width: 320,
                  height: 546,
                  sha256:
                    "42f6593d594fa35c244712bb79ff0561a776ad07e3da2e37115980042c950438",
                  mimeType: "image/gif",
                },
              },
              {
                _ref: "/public/images/1543dbed7fb374a578423123ac14c1cb7028b81f-320x543.gif",
                _type: "file",
                metadata: {
                  width: 320,
                  height: 543,
                  sha256:
                    "447994fa64ed40ad35a2341fe1ba9d64f9a6a72ad267a5ad9aba3b323059e988",
                  mimeType: "image/gif",
                },
              },
              {
                _ref: "/public/images/ba947d1e18c102604f7c7a96dac73600aed999d6-320x554.gif",
                _type: "file",
                metadata: {
                  width: 320,
                  height: 554,
                  sha256:
                    "e65c49e0b0ae01f28c61bbf26a6428b542330f5fc96519512cac3256b8b1a200",
                  mimeType: "image/gif",
                },
              },
              {
                _ref: "/public/images/f4c363ea1e24c29d7628b02d6097383a7228ab57-320x546.gif",
                _type: "file",
                metadata: {
                  width: 320,
                  height: 546,
                  sha256:
                    "a4bae135c8090d905a7ad0796664498961f576186a47f2c2442a8a86fa69e2e3",
                  mimeType: "image/gif",
                },
              },
            ],
          },
          {
            type: "textElement",
            size: "sm",
            text: [
              {
                tag: "p",
                children: [
                  "Det ble sendt inn over 10 000 søknader via sasskien.no de første 24 timene etter lansering.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Løsningen fikk Gull i Gulltaggen og diplom i Visuelt!",
                ],
              },
            ],
            title: "10 000 søknader",
          },
          {
            type: "projectTeamElement",
            employees: ["lee", "mkd", "jbo"],
            header: "Folka",
          },
        ],
        hero: {
          description:
            "SAS Skien er en del av prosjektet Sas Plus/Sas Pussy (SPSP), Karpe sitt hittil største prosjekt med et tidsspenn på over tre år. ",
          image: {
            _ref: "/public/images/49c207c16c48ecc4100b25f9d8ac262f0c85d437-1200x630.webp",
            _type: "file",
            metadata: {
              width: 1200,
              height: 630,
              sha256:
                "15f91f1dc13ea8f599db0838ba3d5c016827db394bf93138fa3a3d83165f94f9",
              mimeType: "image/webp",
            },
          },
          projectSummary: {
            description: null,
            client: "Karpe og Little Big Sister",
            collaborators: "Blank, Also Known As og Karpe",
            contribution: "Et ganske uvanlig søknadsskjema",
          },
          shortDescription:
            "En del av prosjektet Sas Plus/Sas Pussy (SPSP), Karpe sitt hittil største prosjekt.",
          title: "SAS Skien",
        },
        order: 10,
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          hero: {
            type: "object",
            items: {
              description: {
                type: "string",
                options: {},
                opt: true,
                raw: false,
              },
              image: {
                type: "image",
                opt: true,
              },
              projectSummary: {
                type: "object",
                items: {
                  client: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  collaborators: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  contribution: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  description: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                },
                opt: true,
              },
              shortDescription: {
                type: "string",
                options: {},
                opt: true,
                raw: false,
              },
              title: {
                type: "string",
                options: {},
                opt: true,
                raw: false,
              },
            },
            opt: true,
          },
          order: {
            type: "number",
            opt: true,
          },
          colorScheme: {
            type: "object",
            items: {
              backgroundColor: {
                type: "string",
                options: {},
                opt: true,
                raw: true,
              },
              textColor: {
                type: "string",
                options: {},
                opt: true,
                raw: true,
              },
            },
            opt: true,
          },
          content: {
            type: "array",
            item: {
              type: "union",
              key: "type",
              items: [
                {
                  type: "object",
                  items: {
                    size: {
                      type: "union",
                      key: {
                        type: "literal",
                        value: "xs",
                        opt: false,
                      },
                      items: [
                        {
                          type: "literal",
                          value: "sm",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "md",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "lg",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "xl",
                          opt: false,
                        },
                      ],
                      opt: true,
                    },
                    keepAspectRatio: {
                      type: "boolean",
                      opt: true,
                    },
                    clickable: {
                      type: "boolean",
                      opt: true,
                    },
                    alt: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                    type: {
                      type: "literal",
                      value: "singleImageElement",
                      opt: false,
                    },
                    image: {
                      type: "image",
                      opt: false,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    size: {
                      type: "union",
                      key: {
                        type: "literal",
                        value: "xs",
                        opt: false,
                      },
                      items: [
                        {
                          type: "literal",
                          value: "sm",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "md",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "lg",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "xl",
                          opt: false,
                        },
                      ],
                      opt: true,
                    },
                    type: {
                      type: "literal",
                      value: "textElement",
                      opt: false,
                    },
                    title: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                    text: {
                      type: "richtext",
                      opt: false,
                      options: {
                        style: {
                          bold: true,
                          italic: true,
                          lineThrough: true,
                        },
                        block: {
                          h1: true,
                          h2: true,
                          h3: true,
                          h4: true,
                          h5: true,
                          h6: true,
                          ul: true,
                          ol: true,
                        },
                        inline: {
                          a: true,
                          img: true,
                        },
                      },
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    size: {
                      type: "union",
                      key: {
                        type: "literal",
                        value: "xs",
                        opt: false,
                      },
                      items: [
                        {
                          type: "literal",
                          value: "sm",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "md",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "lg",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "xl",
                          opt: false,
                        },
                      ],
                      opt: true,
                    },
                    type: {
                      type: "literal",
                      value: "textAndImageElement",
                      opt: false,
                    },
                    title: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                    text: {
                      type: "richtext",
                      opt: false,
                      options: {
                        style: {
                          bold: true,
                          italic: true,
                          lineThrough: true,
                        },
                        block: {
                          h1: true,
                          h2: true,
                          h3: true,
                          h4: true,
                          h5: true,
                          h6: true,
                          ul: true,
                          ol: true,
                        },
                        inline: {
                          a: true,
                          img: true,
                        },
                      },
                    },
                    image: {
                      type: "image",
                      opt: false,
                    },
                    clickable: {
                      type: "boolean",
                      opt: true,
                    },
                    alt: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                    side: {
                      type: "boolean",
                      opt: true,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    size: {
                      type: "union",
                      key: {
                        type: "literal",
                        value: "xs",
                        opt: false,
                      },
                      items: [
                        {
                          type: "literal",
                          value: "sm",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "md",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "lg",
                          opt: false,
                        },
                        {
                          type: "literal",
                          value: "xl",
                          opt: false,
                        },
                      ],
                      opt: true,
                    },
                    clickable: {
                      type: "boolean",
                      opt: true,
                    },
                    alt: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                    type: {
                      type: "literal",
                      value: "doubleImageElement",
                      opt: false,
                    },
                    image1: {
                      type: "image",
                      opt: false,
                    },
                    image2: {
                      type: "image",
                      opt: false,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    type: {
                      type: "literal",
                      value: "projectQuoteElement",
                      opt: false,
                    },
                    quote: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                    author: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: false,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    type: {
                      type: "literal",
                      value: "multipleImageElement",
                      opt: false,
                    },
                    images: {
                      type: "array",
                      item: {
                        type: "image",
                        opt: false,
                      },
                      opt: false,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    type: {
                      type: "literal",
                      value: "projectTeamElement",
                      opt: false,
                    },
                    employees: {
                      type: "array",
                      item: {
                        type: "keyOf",
                        path: "/content/employees/employeeList.val.ts",
                        schema: {
                          type: "record",
                          item: {
                            type: "object",
                            items: {
                              email: {
                                type: "string",
                                options: {},
                                opt: false,
                                raw: true,
                              },
                              image: {
                                type: "image",
                                opt: false,
                              },
                              name: {
                                type: "string",
                                options: {},
                                opt: false,
                                raw: false,
                              },
                              phoneNumber: {
                                type: "string",
                                options: {},
                                opt: false,
                                raw: false,
                              },
                              contactPerson: {
                                type: "boolean",
                                opt: false,
                              },
                              position: {
                                type: "union",
                                key: {
                                  type: "literal",
                                  value: "Daglig Leder",
                                  opt: false,
                                },
                                items: [
                                  {
                                    type: "literal",
                                    value: "Salgssjef",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Teknolog",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Leder Teknologi",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Fagsjef Teknologi",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Designer",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Leder Design",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Fagsjef Design",
                                    opt: false,
                                  },
                                  {
                                    type: "literal",
                                    value: "Office manager",
                                    opt: false,
                                  },
                                ],
                                opt: false,
                              },
                            },
                            opt: false,
                          },
                          opt: false,
                        },
                        opt: false,
                        values: "string",
                      },
                      opt: false,
                    },
                    header: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                  },
                  opt: false,
                },
                {
                  type: "object",
                  items: {
                    type: {
                      type: "literal",
                      value: "videoElement",
                      opt: false,
                    },
                    video: {
                      type: "file",
                      opt: false,
                    },
                  },
                  opt: false,
                },
              ],
              opt: false,
            },
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/benefits.val.ts": {
    source: [
      {
        image: {
          _ref: "/public/images/fd9758e8ec515b48758ee2a92b0a4a9ec3feceb9-772x538.webp",
          _type: "file",
          metadata: {
            width: 772,
            height: 538,
            sha256:
              "23a3005e3aebd90c45ff8a3de3c2284e8e85c1c48ad1344000e69357f35c977b",
            mimeType: "image/webp",
          },
        },
        text: [
          {
            tag: "p",
            children: [
              "Du vil få fri tilgang til Blank sitt kontor ved Youngstorget i Oslo hvor vi stiller med det av utstyr du måtte trenge. Designere, teknologer og produktledere fra Blank vil selvsagt være tilgjengelige for både sparring og veiledning.  ",
            ],
          },
          {
            tag: "p",
            children: [
              "Det skjer alltid noe sosialt og gøy i Blank, som det bare er å bli med på når du vil. ",
              {
                tag: "span",
                styles: ["bold"],
                children: [
                  "Det hele starter med felles tur til Øya-festivalen fredag 11.08.",
                ],
              },
            ],
          },
        ],
        title: "Dette kan du forvente med høstjobb i Blank",
      },
      {
        image: {
          _ref: "/public/images/d839bd22e6d63385858240fddbc5dfc89a7f7f8b-1638x1027.webp",
          _type: "file",
          metadata: {
            width: 1638,
            height: 1027,
            sha256:
              "d33523980810cfdf40bb4877f74361618dbe70917ea579edc63b33fce1ce5cbd",
            mimeType: "image/webp",
          },
        },
        text: [
          {
            tag: "ul",
            children: [
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Hos oss får du ",
                      {
                        tag: "a",
                        href: "https://betingelser.blank.no/",
                        children: ["gode betingelser"],
                      },
                      " – det er en selvfølge",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Vi praktiserer åpen lønn (helt på ordentlig)"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Du får være med å drive selskapet"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Du får være med å velge hvilke oppdrag du skal jobbe på",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Du blir del av et særdeles sterkt fagmiljø med veldig stor takhøyde",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Alle som begynner i Blank får aksjer og blir medeiere",
                    ],
                  },
                ],
              },
            ],
          },
        ],
        title: "Betingelser og slikt",
      },
      {
        image: {
          _ref: "/public/images/c5b6b478301b3c949a36c2707d2130977e9677ce-1600x962.webp",
          _type: "file",
          metadata: {
            width: 1600,
            height: 962,
            sha256:
              "5d27e3bd329e23f96ccf9115ad26eedd9fdf1ee566a9a04a2ee522b809cfda8a",
            mimeType: "image/webp",
          },
        },
        text: [
          {
            tag: "ul",
            children: [
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Utfordrende oppdrag som løser viktige problemer",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Tilhørighet i et skarpt fagmiljø"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Godt arbeidsmiljø med svær takhøyde"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Tenke og bestemme ting sjæl"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Bra lønn! Det fortjener du. ",
                      {
                        tag: "a",
                        href: "https://www.blank.no/betingelser/",
                        children: ["Sjekk selv om du lurer"],
                      },
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Være med å eie sjappa sammen med oss andre"],
                  },
                ],
              },
            ],
          },
        ],
        title: "Dette kan du forvente som ansatt i Blank",
      },
    ],
    schema: {
      type: "array",
      item: {
        type: "object",
        items: {
          image: {
            type: "image",
            opt: true,
          },
          text: {
            type: "richtext",
            opt: true,
            options: {
              style: {
                bold: true,
                italic: true,
                lineThrough: true,
              },
              block: {
                h1: true,
                h2: true,
                h3: true,
                h4: true,
                h5: true,
                h6: true,
                ul: true,
                ol: true,
              },
              inline: {
                a: true,
                img: true,
              },
            },
          },
          title: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/pages/projects.val.ts": {
    source: {
      contactUsJob:
        "Vi er alltid interessert i å snakke med folk som er interessert i oss - designere, utviklere eller enhjørninger. Er du allerede solgt kan du trykke på en av snurreknappene våre, så avtaler vi en bli-kjent-prat.",
      contactUsProject:
        "Vi tar mer en gjerne en prat om ditt prosjekt, enten du har holdt på i årevis eller skal starte noe splitter nytt!",
      projects: [
        {
          layout: "LARGE",
          project: "remarkable",
        },
        {
          layout: "SMALL",
          project: "ice",
        },
        {
          layout: "SMALL",
          project: "bboy",
        },
        {
          layout: "SMALL",
          project: "morgenlevering",
        },
        {
          layout: "SMALL",
          project: "finn",
        },
        {
          layout: "SMALL",
          project: "hjemmelegene",
        },
        {
          layout: "SMALL",
          project: "sas-skien",
        },
        {
          layout: "LARGE",
          project: "amoi",
        },
        {
          layout: "SMALL",
          project: "aneo",
        },
        {
          layout: "SMALL",
          project: "reisen-til-spektrum",
        },
      ],
      theme: "dark",
      title: "Portfolio",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        contactUsJob: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        contactUsProject: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        projects: {
          type: "array",
          item: {
            type: "object",
            items: {
              layout: {
                type: "union",
                key: {
                  type: "literal",
                  value: "SMALL",
                  opt: false,
                },
                items: [
                  {
                    type: "literal",
                    value: "LARGE",
                    opt: false,
                  },
                ],
                opt: false,
              },
              project: {
                type: "keyOf",
                path: "/content/projects.val.ts",
                schema: {
                  type: "record",
                  item: {
                    type: "object",
                    items: {
                      hero: {
                        type: "object",
                        items: {
                          description: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: false,
                          },
                          image: {
                            type: "image",
                            opt: true,
                          },
                          projectSummary: {
                            type: "object",
                            items: {
                              client: {
                                type: "string",
                                options: {},
                                opt: true,
                                raw: false,
                              },
                              collaborators: {
                                type: "string",
                                options: {},
                                opt: true,
                                raw: false,
                              },
                              contribution: {
                                type: "string",
                                options: {},
                                opt: true,
                                raw: false,
                              },
                              description: {
                                type: "string",
                                options: {},
                                opt: true,
                                raw: false,
                              },
                            },
                            opt: true,
                          },
                          shortDescription: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: false,
                          },
                          title: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: false,
                          },
                        },
                        opt: true,
                      },
                      order: {
                        type: "number",
                        opt: true,
                      },
                      colorScheme: {
                        type: "object",
                        items: {
                          backgroundColor: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: true,
                          },
                          textColor: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: true,
                          },
                        },
                        opt: true,
                      },
                      content: {
                        type: "array",
                        item: {
                          type: "union",
                          key: "type",
                          items: [
                            {
                              type: "object",
                              items: {
                                size: {
                                  type: "union",
                                  key: {
                                    type: "literal",
                                    value: "xs",
                                    opt: false,
                                  },
                                  items: [
                                    {
                                      type: "literal",
                                      value: "sm",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "md",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "lg",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "xl",
                                      opt: false,
                                    },
                                  ],
                                  opt: true,
                                },
                                keepAspectRatio: {
                                  type: "boolean",
                                  opt: true,
                                },
                                clickable: {
                                  type: "boolean",
                                  opt: true,
                                },
                                alt: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                                type: {
                                  type: "literal",
                                  value: "singleImageElement",
                                  opt: false,
                                },
                                image: {
                                  type: "image",
                                  opt: false,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                size: {
                                  type: "union",
                                  key: {
                                    type: "literal",
                                    value: "xs",
                                    opt: false,
                                  },
                                  items: [
                                    {
                                      type: "literal",
                                      value: "sm",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "md",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "lg",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "xl",
                                      opt: false,
                                    },
                                  ],
                                  opt: true,
                                },
                                type: {
                                  type: "literal",
                                  value: "textElement",
                                  opt: false,
                                },
                                title: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                                text: {
                                  type: "richtext",
                                  opt: false,
                                  options: {
                                    style: {
                                      bold: true,
                                      italic: true,
                                      lineThrough: true,
                                    },
                                    block: {
                                      h1: true,
                                      h2: true,
                                      h3: true,
                                      h4: true,
                                      h5: true,
                                      h6: true,
                                      ul: true,
                                      ol: true,
                                    },
                                    inline: {
                                      a: true,
                                      img: true,
                                    },
                                  },
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                size: {
                                  type: "union",
                                  key: {
                                    type: "literal",
                                    value: "xs",
                                    opt: false,
                                  },
                                  items: [
                                    {
                                      type: "literal",
                                      value: "sm",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "md",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "lg",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "xl",
                                      opt: false,
                                    },
                                  ],
                                  opt: true,
                                },
                                type: {
                                  type: "literal",
                                  value: "textAndImageElement",
                                  opt: false,
                                },
                                title: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                                text: {
                                  type: "richtext",
                                  opt: false,
                                  options: {
                                    style: {
                                      bold: true,
                                      italic: true,
                                      lineThrough: true,
                                    },
                                    block: {
                                      h1: true,
                                      h2: true,
                                      h3: true,
                                      h4: true,
                                      h5: true,
                                      h6: true,
                                      ul: true,
                                      ol: true,
                                    },
                                    inline: {
                                      a: true,
                                      img: true,
                                    },
                                  },
                                },
                                image: {
                                  type: "image",
                                  opt: false,
                                },
                                clickable: {
                                  type: "boolean",
                                  opt: true,
                                },
                                alt: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                                side: {
                                  type: "boolean",
                                  opt: true,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                size: {
                                  type: "union",
                                  key: {
                                    type: "literal",
                                    value: "xs",
                                    opt: false,
                                  },
                                  items: [
                                    {
                                      type: "literal",
                                      value: "sm",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "md",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "lg",
                                      opt: false,
                                    },
                                    {
                                      type: "literal",
                                      value: "xl",
                                      opt: false,
                                    },
                                  ],
                                  opt: true,
                                },
                                clickable: {
                                  type: "boolean",
                                  opt: true,
                                },
                                alt: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                                type: {
                                  type: "literal",
                                  value: "doubleImageElement",
                                  opt: false,
                                },
                                image1: {
                                  type: "image",
                                  opt: false,
                                },
                                image2: {
                                  type: "image",
                                  opt: false,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                type: {
                                  type: "literal",
                                  value: "projectQuoteElement",
                                  opt: false,
                                },
                                quote: {
                                  type: "string",
                                  options: {},
                                  opt: false,
                                  raw: false,
                                },
                                author: {
                                  type: "string",
                                  options: {},
                                  opt: true,
                                  raw: false,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                type: {
                                  type: "literal",
                                  value: "multipleImageElement",
                                  opt: false,
                                },
                                images: {
                                  type: "array",
                                  item: {
                                    type: "image",
                                    opt: false,
                                  },
                                  opt: false,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                type: {
                                  type: "literal",
                                  value: "projectTeamElement",
                                  opt: false,
                                },
                                employees: {
                                  type: "array",
                                  item: {
                                    type: "keyOf",
                                    path: "/content/employees/employeeList.val.ts",
                                    schema: {
                                      type: "record",
                                      item: {
                                        type: "object",
                                        items: {
                                          email: {
                                            type: "string",
                                            options: {},
                                            opt: false,
                                            raw: true,
                                          },
                                          image: {
                                            type: "image",
                                            opt: false,
                                          },
                                          name: {
                                            type: "string",
                                            options: {},
                                            opt: false,
                                            raw: false,
                                          },
                                          phoneNumber: {
                                            type: "string",
                                            options: {},
                                            opt: false,
                                            raw: false,
                                          },
                                          contactPerson: {
                                            type: "boolean",
                                            opt: false,
                                          },
                                          position: {
                                            type: "union",
                                            key: {
                                              type: "literal",
                                              value: "Daglig Leder",
                                              opt: false,
                                            },
                                            items: [
                                              {
                                                type: "literal",
                                                value: "Salgssjef",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Teknolog",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Leder Teknologi",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Fagsjef Teknologi",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Designer",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Leder Design",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Fagsjef Design",
                                                opt: false,
                                              },
                                              {
                                                type: "literal",
                                                value: "Office manager",
                                                opt: false,
                                              },
                                            ],
                                            opt: false,
                                          },
                                        },
                                        opt: false,
                                      },
                                      opt: false,
                                    },
                                    opt: false,
                                    values: "string",
                                  },
                                  opt: false,
                                },
                                header: {
                                  type: "string",
                                  options: {},
                                  opt: false,
                                  raw: false,
                                },
                              },
                              opt: false,
                            },
                            {
                              type: "object",
                              items: {
                                type: {
                                  type: "literal",
                                  value: "videoElement",
                                  opt: false,
                                },
                                video: {
                                  type: "file",
                                  opt: false,
                                },
                              },
                              opt: false,
                            },
                          ],
                          opt: false,
                        },
                        opt: false,
                      },
                    },
                    opt: false,
                  },
                  opt: false,
                },
                opt: false,
                values: "string",
              },
            },
            opt: false,
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/about.val.ts": {
    source: {
      header: "Spesialister på digital produktutvikling",
      image: {
        _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
        _type: "file",
        metadata: {
          width: 1920,
          height: 1281,
          sha256:
            "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
          mimeType: "image/webp",
        },
      },
      ingress:
        "Vi elsker å bygge digitale tjenester som betyr noe for folk, helt fra bunn av, og helt ferdig. Vi tror på iterative utviklingsprosesser, tverrfaglige team, designdrevet produktutvikling og brukersentrerte designmetoder.",
      pageElements: [
        {
          image: {
            _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
            _type: "file",
            metadata: {
              width: 1920,
              height: 1281,
              sha256:
                "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
              mimeType: "image/webp",
            },
          },
          size: "lg",
          alt: "",
          keepAspectRatio: true,
          clickable: true,
          type: "singleImageElement",
        },
        {
          type: "textElement",
          size: "sm",
          text: [
            {
              tag: "p",
              children: [
                "Noen av ",
                {
                  tag: "a",
                  href: "https://www.blank.no/prosjekter",
                  children: ["selskapene vi jobber med"],
                },
                " er små, andre er store. Alle har de høye ambisjoner og stiller høye krav til hvem de jobber med. Noen ganger starter vi opp egne selskaper også. Mest fordi vi liker å bygge ting, men også fordi smarte folk har gode idéer som fortjener å bli realisert.",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "br",
                },
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://www.blank.no/prosjekter",
                  children: ["Ting vi har bygd for kundene våre"],
                },
              ],
            },
          ],
          title: null,
        },
        {
          type: "textElement",
          size: "sm",
          text: [
            {
              tag: "p",
              children: [
                "I Blank er vi ",
                {
                  tag: "a",
                  href: "https://www.blank.no/menneskene",
                  children: ["en gjeng på omtrent 60 ulike folk"],
                },
                " som er ekstremt dyktige i faget sitt – digital produktutvikling. Vi er en tredjedel designere og resten teknologer.",
              ],
            },
          ],
          title: "Menneskene",
        },
        {
          type: "textAndImageElement",
          image: {
            _ref: "/public/images/dbcb029cf591f7424afeba3f21cbf7f641e704ba-3500x2333.webp",
            _type: "file",
            metadata: {
              width: 3500,
              height: 2333,
              sha256:
                "1d7488b8dbf5583a945817b2d22aefdebdcd9dee0eb4062e6627ed9ee03e1af9",
              mimeType: "image/webp",
            },
          },
          text: [
            {
              tag: "p",
              children: [
                "Vi startet Blank fordi vi ønsket oss et konsulentselskap hvor vi kan lære og utfordre oss selv. Men også et selskap hvor det er veldig fint å jobbe, og kanskje aller mest – fordi vi liker å bygge ting.",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "br",
                },
              ],
            },
            {
              tag: "p",
              children: [
                "I tillegg ønsket vi å forandre bransjen og hvordan et konsulentselskap kan fungere.",
              ],
            },
          ],
          title: "Derfor startet vi Blank",
          alt: "",
          clickable: null,
          side: false,
          size: null,
        },
        {
          type: "textAndImageElement",
          image: {
            _ref: "/public/images/d09c934bc9d2aa96097baa0fa7affc586040f3f0-850x538.gif",
            _type: "file",
            metadata: {
              width: 850,
              height: 538,
              sha256:
                "2fced3fa91c7f0ee625066e1787b13815807cf47b5ae35567885ea05f91595da",
              mimeType: "image/gif",
            },
          },
          size: null,
          text: [
            {
              tag: "p",
              children: [
                "Vi liker å bygge digitale tjenester som betyr noe for folk, helt fra bunn av, og helt ferdig. Vi tror på iterative utviklingsprosesser, tverrfaglige team, designdrevet produktutvikling og brukersentrerte designmetoder.  ",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "br",
                },
              ],
            },
            {
              tag: "p",
              children: [
                "Vi liker å eksperimentere og å teste ut nye ting, både i oppdrag og internt. Vi liker å jobbe tett og langsiktig med kundene våre, både hos kundene, hjemmefra eller fra Blank-loftet. Vi tror digitale tjenester er en viktig del av det bærekraftige samfunnet vi skal bygge sammen.",
              ],
            },
          ],
          title: "Ting vi liker",
          side: true,
          alt: null,
          clickable: null,
        },
        {
          type: "textAndImageElement",
          image: {
            _ref: "/public/images/93c71a8ba039fbd87d2fa99d5a7180fbca566006-2846x1930.webp",
            _type: "file",
            metadata: {
              width: 2846,
              height: 1930,
              sha256:
                "15c1f0421cb9a0cb713ea6fa83cd7baf2cd2c1943e5de4f4f008cb2b29c0f2d4",
              mimeType: "image/webp",
            },
          },
          size: null,
          text: [
            {
              tag: "p",
              children: [
                "Når vi ikke er ute hos kundene våre holder vi hus på Loftet vårt i ",
                {
                  tag: "a",
                  href: "https://maps.app.goo.gl/VUHMDbF6ppPQKmqJ6",
                  children: ["Torggata 15"],
                },
                ". Her jobber vi sammen, her trekker vi oss tilbake når vi trenger det, her utvikler vi faget vårt, her tar vi en kaffe på takterrassen og her river vi i en skikkelig fest for alle vennene våre med jevne mellomrom.  ",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "br",
                },
              ],
            },
            {
              tag: "p",
              children: [
                "For oss som jobber i Blank er Loftet også et møtested utenom arbeidstid, et sted vi kan feire bursdag eller bryllup og ha en gaming session med barna. Loftet er hjemme, (men på jobben, da).",
              ],
            },
          ],
          title: "Loftet vårt",
          side: null,
          alt: null,
          clickable: null,
        },
        {
          type: "textAndImageElement",
          image: {
            _ref: "/public/images/c5b6b478301b3c949a36c2707d2130977e9677ce-1600x962.webp",
            _type: "file",
            metadata: {
              width: 1600,
              height: 962,
              sha256:
                "5d27e3bd329e23f96ccf9115ad26eedd9fdf1ee566a9a04a2ee522b809cfda8a",
              mimeType: "image/webp",
            },
          },
          size: null,
          text: [
            {
              tag: "p",
              children: [
                "Liker du en del av det samme som oss, da bør vi kanskje jobbe sammen! Vi er alltid på jakt etter dyktige utviklere og digitale designere. Enten du er tidlig i karrieren eller klar for å lede an i den faglige utviklingen vil vi gjerne bli bedre kjent.  ",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "br",
                },
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://www.blank.no/jobb",
                  children: ["Jobb i Blank"],
                },
              ],
            },
          ],
          title: "Noe for deg?",
          side: true,
          alt: null,
          clickable: null,
        },
      ],
      theme: "dark",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        header: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        ingress: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        image: {
          type: "image",
          opt: false,
        },
        pageElements: {
          type: "array",
          item: {
            type: "union",
            key: "type",
            items: [
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  keepAspectRatio: {
                    type: "boolean",
                    opt: true,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  type: {
                    type: "literal",
                    value: "singleImageElement",
                    opt: false,
                  },
                  image: {
                    type: "image",
                    opt: false,
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  type: {
                    type: "literal",
                    value: "textElement",
                    opt: false,
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  text: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  type: {
                    type: "literal",
                    value: "textAndImageElement",
                    opt: false,
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  text: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                  image: {
                    type: "image",
                    opt: false,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  side: {
                    type: "boolean",
                    opt: true,
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  type: {
                    type: "literal",
                    value: "doubleImageElement",
                    opt: false,
                  },
                  image1: {
                    type: "image",
                    opt: false,
                  },
                  image2: {
                    type: "image",
                    opt: false,
                  },
                },
                opt: false,
              },
            ],
            opt: false,
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/events.val.ts": {
    source: {
      "no-code": {
        date: "2023-09-01T06:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/5a678d1dfb4557ed5fc7ee4dd9535a62a332a751-2500x1429.webp",
          _type: "file",
          metadata: {
            width: 2500,
            height: 1429,
            sha256:
              "48e29fbd1355abef381b3122b4b7494589a6ef2e11ba47a366a09aac9b1d7587",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "No-code eller low-code har på få år gått fra å være entusiastbegreper til å være noe alle CTOer og CDOer har på leppene. Selveste Chris Wanstrath, grunnlegger og tidligere CEO i Github, hevder at fremtiden til kode er ingen kode i det hele tatt. Men hva er no-code? What's the catch? Og når bør det brukes? Bli med på et foredrag med ",
              {
                tag: "a",
                href: "https://www.appfarm.io/",
                children: ["Appfarm"],
              },
              ' - en norskutviklet "fullstack" no-code plattform. Foredraget skal gi deg overblikk og innsikt i teknologien og muligheter, inkludert når man bør bruke no-code som alternativ til kode eller hyllevare. Det blir også en kort demo av selve plattformen.',
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank, Torggata 15",
        },
        main: [
          {
            tag: "p",
            children: [
              "Kristian har jobbet med no-code i 14 år - både som utvikler, arkitekt, designer og prosjektleder. Han var med å starte ",
              {
                tag: "a",
                href: "https://www.appfarm.io/",
                children: ["Appfarm"],
              },
              " for litt over 5 år siden, og jobber i dag med uviklerverktøyet Appfarm Create, utvikleropplevelsen og opplæring.",
            ],
          },
        ],
        program: [
          {
            description: "Croissanter og kaffe",
            time: "0800",
          },
          {
            description: "Kristian snakker",
            time: "0830",
          },
          {
            description: "Q&A",
            time: "0915",
          },
          {
            description: "Mer kaffe?",
            time: "0930",
          },
          {
            description: "Dørene lukkes",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        typeformId: null,
        signupLink:
          "https://www.eventbrite.com/e/705968459667?aff=oddtdtcreator",
        signupOpen: true,
        signupOpens: "2023-08-25T06:08:00.000Z",
        speakers: [
          {
            name: "Kristian Mella",
            roles: ["Appfarm - VP Product Ecosystem"],
            speakerImage: {
              _ref: "/public/images/e76173f4367e9c5dbba28c6c903d7e4590f66ba1-2362x3150.webp",
              _type: "file",
              metadata: {
                width: 2362,
                height: 3150,
                sha256:
                  "df54a6d3105437ff250a197c2d65cd83581bf9c303b36a604d18c29af0214f29",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: '"The future of coding is no coding at all"',
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription: null,
        metadataTitle: null,
      },
      amoi: {
        date: "2023-06-02T06:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/38f9b2794fd646bf2f7cb8c0941f1a0521b513ee-4756x2042.webp",
          _type: "file",
          metadata: {
            width: 4756,
            height: 2042,
            sha256:
              "ddb41af6888c1a906fd5ed36b1ab8703fb82be0deb1f679d6e7683c0a104c542",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "How does one of the oldest companies in Norway transition into the 21st century? 3 years ago, we began working together with a small startup team of seven in Posten’s innovation hub to help answer that very question. We will share what it’s been like to build AMOI (amoi.no) from strategy, to sketch to pilot, and from pilot to launch and now growth. You will get an insight into how we have gone about building an agile new brand and service in a start-up team. And hear about our focus on building a service that seeks to benefit people, partners and be profitable for Posten.",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank",
        },
        main: [
          {
            tag: "p",
            children: [
              "Lee is an experienced designer with over 15 years experience working on UX, branding and strategy. He has extensive experience in designing robust, user-focused digital interfaces. Lee has worked for many major Norwegian clients most recently winning awards for his work for hip-hop artist Karpe and with AMOI.",
            ],
          },
          {
            tag: "p",
            children: [
              "Jimmy is the CEO and founder of AMOI and part of the Posten Group. Jimmy has been on the AMOI journey since start from idea to implementation and has the overall responsibility for the business.",
            ],
          },
        ],
        program: [
          {
            description: "Croissanter og kaffe",
            time: "0800",
          },
          {
            description: "Lee og Jimmy snakker",
            time: "0830",
          },
          {
            description: "Q&A",
            time: "0915",
          },
          {
            description: "Mer kaffe?",
            time: "0930",
          },
          {
            description: "Dørene lukkes",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        typeformId: null,
        signupLink:
          "https://www.eventbrite.com/e/kjregar-004-how-a-potato-can-help-create-an-e-commerce-startup-amoi-tickets-632542841667",
        signupOpen: true,
        signupOpens: "2023-05-08T12:44:00.000Z",
        speakers: [
          {
            name: "Lee Frost",
            roles: ["Fagleder for Design"],
            speakerImage: {
              _ref: "/public/images/a82d6c4f6c961c7119adba753296897687b05873-1007x1007.webp",
              _type: "file",
              metadata: {
                width: 1007,
                height: 1007,
                sha256:
                  "14af6725e1ee949c31a116a64cb019fde12bc3538db3d25d4880db94ee685620",
                mimeType: "image/webp",
              },
            },
          },
          {
            name: "Jimmy Rhodin",
            roles: ["CEO of AMOI"],
            speakerImage: {
              _ref: "/public/images/22b594b715e02423523d4f4a44281f1d36ceafb0-1477x1476.webp",
              _type: "file",
              metadata: {
                width: 1477,
                height: 1476,
                sha256:
                  "8786b556f0a9c2ab2f0411c638360c11276d46f37182fdf39f3ca824ba0072bf",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "AMOI: Building a Digital Marketplace from Scratch",
        eventbriteEventId: 639219521797,
        eventbriteUrl:
          "https://www.eventbrite.com/e/aasdasdasd-tickets-639219521797",
        metadataDescription: null,
        metadataTitle: null,
      },
      "ai-tekst-og-bildegenerering": {
        date: "2023-03-24T07:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/ce394523806509a98f4b240c64fa75e88fce1c00-1704x1704.webp",
          _type: "file",
          metadata: {
            width: 1704,
            height: 1704,
            sha256:
              "314b61b469a3b713438e15f3f78925544db81d51783cf02aa0639b15eb36449c",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Er du nysgjerrig på open source-alternativer til Dall-E og ChatGPT?",
            ],
          },
          {
            tag: "p",
            children: [
              "Vi ser på noen helt åpne alternativer til de mest populære og kommersielle AI for tekst (GPT-3 og ChatGPT) og bildegenerering (DALL-E). Foredraget fokuserer på hvordan man ta i bruk helt åpne modeller på maskinvare man styrer selv.",
            ],
          },
          {
            tag: "p",
            children: [
              "Alt som vises er 100% open source og kan kjøres på ordinær high-end maskinvare tilgjengelig i butikken på hjørnet.",
            ],
          },
          {
            tag: "p",
            children: [
              "Det blir praktisk oppsett og små kodedemoer med fokus på å senke terskelen for at flere utviklere og designere sammen begynner å utforske og bygge løsninger med AI uten de kommersielle avhengighetene.",
            ],
          },
          {
            tag: "p",
            children: [
              "Foredraget passer til alle nybegynnere innen maskinlæring eller de som er nysgjerrige på hvordan man kan ta i bruk åpne modeller på maskinvare man styrer selv.",
            ],
          },
          {
            tag: "p",
            children: [
              "Det er en stor fordel hvis man er komfortabel med utviklerverktøy og kan kode litt, men dette er ikke et absolutt krav siden vi prøver å forklare alt vi gjør underveis.",
            ],
          },
          {
            tag: "p",
            children: ["Vi sees!"],
          },
          {
            tag: "p",
            children: [
              "«Kjøregår» er en serie med åpne foredrag hos Blank, og alle som er nysgjerrige er hjertelig velkommen. Begrenset antall plasser.",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank, Torggata 15",
        },
        main: [
          {
            tag: "p",
            children: [
              "Fremveksten av kunstig intelligens på alle kanter både forbløffer og forferder oss. Som erfaren utvikler er Andreas mest gira og ivrig på å finne svar på hvordan og hva vi kan bruke den til. I dag. Kom og hør Andreas dele litt om hvordan man kommer i gang med åpne alternativer til de kommersielle løsningene bak API og betalingsmur.",
            ],
          },
          {
            tag: "p",
            children: ["Zero API tokens required!"],
          },
        ],
        program: [
          {
            description: "Croissanter og kaffe",
            time: "0800",
          },
          {
            description: "Andreas snakker og viser",
            time: "0830",
          },
          {
            description: "Q&A",
            time: "0915",
          },
          {
            description: "Mer kaffe?",
            time: "0930",
          },
          {
            description: "Dørene lukkes",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        typeformId: null,
        signupLink: "https://kjoregar003.eventbrite.com",
        signupOpen: true,
        signupOpens: null,
        speakers: [
          {
            name: "Andreas Rudi Søvik",
            roles: ["Erfaren teknolog i Blank"],
            speakerImage: {
              _ref: "/public/images/8d71720997e6e0f8348d86e4c9696e60b2333e0c-573x573.webp",
              _type: "file",
              metadata: {
                width: 573,
                height: 573,
                sha256:
                  "8ca5d9dba7e2a64e9cf1092f8a7dffd05bfc602e574ed2b01f46fb7bf840c723",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Tekst og bildegenerering med open source AI",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription: null,
        metadataTitle: null,
      },
      karpe: {
        date: "2022-12-02T07:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/408ce60647b86bb26604be1b84e51d66e6df99a5-816x795.webp",
          _type: "file",
          metadata: {
            width: 816,
            height: 795,
            sha256:
              "ddc17e8d8ff42afc5f73fecccff9cf44498000415e5ca925db56f42d7051814b",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Silje Larsen Borgan i management- og kommunikasjonsselskapet Little Big Sister har artister som Karpe, Emilie Nicolas, Cezinando og Gabrielle i stallen.",
            ],
          },
          {
            tag: "p",
            children: [
              "«Kjøregår» er en serie med åpne foredrag hos Blank, og alle som er nysgjerrige er hjertelig velkommen. Begrensede plasser og påmelding på lenke.",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank, Torggata 15",
        },
        main: [
          {
            tag: "p",
            children: [
              "Fredag 2. desember kommer Silje på besøk til Blank for å fortelle om hvordan Karpe jobbet for å utvikle og gjennomføre konsertene i Skien og Spektrum.Vi får også høre om hvordan LBS og Karpe jobbet med Blank for å lage påmeldingsløsningen til Skien-konsertene.",
            ],
          },
        ],
        program: [
          {
            description: "Dørene åpner",
            time: "0800",
          },
          {
            description: "Silje og SAS Skien, og mingling",
            time: "0830",
          },
          {
            description: "Besøkende kastes ut",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        typeformId: null,
        signupLink: "https://www.blank.no",
        signupOpen: null,
        signupOpens: null,
        speakers: [
          {
            name: "Silje Larsen Borgan",
            roles: [
              "Manager for Karpe, Emilie Nicolas, Cezinando og Gabrielle",
            ],
            speakerImage: {
              _ref: "/public/images/836e4be17e3b4eb60d439250e4ae1ab2ee84eb40-980x674.webp",
              _type: "file",
              metadata: {
                width: 980,
                height: 674,
                sha256:
                  "311859dc873ca91cf3ee09937e6e624ea4ddfa0f2e08c0841b54464507fe01f0",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Fra SAS Skien til SAS spektrum",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription: null,
        metadataTitle: null,
      },
      modyfi: {
        date: "2023-10-13T06:00:00.000Z",
        eventFull: true,
        eventImage: {
          _ref: "/public/images/0f4ea116e512da3cc5006840d76e899c6a0029fb-3010x1692.webp",
          _type: "file",
          metadata: {
            width: 3010,
            height: 1692,
            sha256:
              "e50b6871748417d0c49e9837dac3a582a94ddd1c0cf275843cc2a812fa02104a",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "What does the future of graphic design tools look like? Technologies such as computational design and generative AI are changing the landscape of what it means to create visual imagery.",
            ],
          },
          {
            tag: "p",
            children: [
              "Computational designer Felix Faire (",
              {
                tag: "a",
                href: "https://felixfaire.com/",
                children: ["felixfaire.com"],
              },
              ") introduces Modyfi (",
              {
                tag: "a",
                href: "https://www.modyfi.com/",
                children: ["modyfi.com"],
              },
              "): a brand new startup building the next generation of collaborative image making tools for artists and designers, and invites all participants to get involved in shaping its future.",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank, Torggata 15",
        },
        main: [
          {
            tag: "p",
            children: [
              "Felix Faire is a multidisciplinary computational designer specializing in real-time graphic tools, instruments and experiences. He has previously worked with clients such as Google, Microsoft, Pentagram and Field.io, and is currently leading graphics development at Modyfi, a new startup building the future of collaborative creative tools for artists and designers.",
            ],
          },
        ],
        program: [
          {
            description: "Croissanter og kaffe",
            time: "0800",
          },
          {
            description: "Felix prater",
            time: "0830",
          },
          {
            description: "Q&A",
            time: "0915",
          },
          {
            description: "Mer kaffe?",
            time: "0930",
          },
          {
            description: "Dørene lukkes",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        typeformId: null,
        signupLink:
          "https://www.eventbrite.com/e/kjregar-006-modyfi-future-tools-for-artists-and-designers-tickets-726002391697",
        signupOpen: true,
        signupOpens: "2023-09-22T06:00:00.000Z",
        speakers: [
          {
            name: "Felix Faire",
            roles: null,
            speakerImage: {
              _ref: "/public/images/a7dd838019ea24f6dc5f1dd785b60073e0e3692f-640x640.webp",
              _type: "file",
              metadata: {
                width: 640,
                height: 640,
                sha256:
                  "27025640057213b58ca678f4f041c673af7f37e78e121e522e29c4ace33b4584",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Future tools for artists and designers ",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription:
          "(The presentation will be given in English)\n\nWhat does the future of graphic design tools look like? Technologies such as computational design and generative AI are changing the landscape of what it means to create visual imagery. ",
        metadataTitle:
          "Felix Faire + Modyfi: Future tools for artists and designers ",
      },
      "naar-alt-gaar-galt": {
        date: "2023-02-03T07:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/b2d9c4e36751d4f8137f1e29b67b784f5b965837-4000x2668.webp",
          _type: "file",
          metadata: {
            width: 4000,
            height: 2668,
            sha256:
              "e175c8157a39de0e244e515ecf9a84e366fdff11a5b50b706fde0996d03126ba",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Ida Aalen er forfatter, gründer og produktcoach. Hun skriver for tiden en bok om produktledelse, og hjelper organisasjoner å bli bedre på produktstrategi og -ledelse.",
            ],
          },
          {
            tag: "p",
            children: [
              "«Kjøregår» er en serie med åpne foredrag hos Blank, og alle som er nysgjerrige er hjertelig velkommen. Begrenset antall plasser",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://www.google.com/maps/place/Torggata+15,+0181+Oslo/data=!4m2!3m1!1s0x46416e63c947c01b:0x102ad373936ea426?sa=X&ved=2ahUKEwje3pTA8av9AhUzCBAIHbrjBh0Q8gF6BAgjEAI",
                  children: ["Torggata 15, 0181 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank, Torggata 15",
        },
        main: [
          {
            tag: "p",
            children: [
              "Før hun startet for seg selv var hun i 5 år medgründer og produktsjef i den norske startupen Confrere, som i 2022 ble solgt til Silicon Valley-selskapet Daily.",
            ],
          },
          {
            tag: "p",
            children: [
              "Etter å ha lest alle de riktige bøkene og sett alle de riktige foredragene klør du sikkert i fingra etter å gjøre alt riktig – noe Ida fikk muligheten til å forsøke i Confrere i 2021. Det pandemi-boostede videoselskapet stod ovenfor en utfordring da verdens kontorer begynte å åpne igjen.",
            ],
          },
          {
            tag: "p",
            children: [
              "Ida erfarte at du kan gjøre alt riktig, men at det allikevel ikke er nok. «Når det går riktig feil» er et ærlig foredrag om hva som gikk bra, og ikke fullt så bra, da Confrere måtte finne hva de skulle leve av etter korona.",
            ],
          },
        ],
        program: [
          {
            description: "Frokost",
            time: "0800",
          },
          {
            description: "«Når det går riktig feil»",
            time: "0830",
          },
          {
            description: "Q&A",
            time: "0915",
          },
          {
            description: "Mer kaffe?",
            time: "0930",
          },
          {
            description: "Dørene lukkes",
            time: "1000",
          },
        ],
        series: "kjoregaar",
        signupLink: "https://www.blank.no",
        signupOpen: null,
        signupOpens: null,
        speakers: [
          {
            name: "Ida Aalen",
            roles: [
              "Produktcoach",
              "Tidligere medgründer og produktsjef i Confrere",
            ],
            speakerImage: {
              _ref: "/public/images/b101335fb1d3fded60d52557cf71467bb035dbb5-142x142.webp",
              _type: "file",
              metadata: {
                width: 142,
                height: 142,
                sha256:
                  "44e8befd5c4ca87b772c9b54f6a9effbbfbd394e347ff56944e777e96bb115f5",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Når det går riktig feil",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription: null,
        metadataTitle: null,
        typeformId: null,
      },
      byggesakai: {
        date: "2023-12-08T07:00:00.000Z",
        typeformId: null,
        eventFull: false,
        eventImage: {
          _ref: "/public/images/267c95fe418574f06f5e06c619689d390ee22437-3600x1884.webp",
          _type: "file",
          metadata: {
            width: 3600,
            height: 1884,
            sha256:
              "d3dbaec48e77b5d42dbe0952dbdf27faa7c42a216cd8b419de01354f94af5bcb",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Alt handler om AI om dagen – men hvor lang er egentlig veien fra å snakke om språkmodeller, til å ta dem i bruk for å effektivisere arbeid? Ikke nødvendigvis veldig lang!",
            ],
          },
          {
            tag: "p",
            children: [
              "Dario og Cornelia forteller historien om hvordan Blank – i samarbeid med NKF – brukte språkmodeller til å bygge et semantisk søk, for at saksbehandlere kan finne lettere frem i forskrifter og lovdata.",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "a",
                href: "https://byggesak.ai",
                children: ["https://byggesak.ai"],
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "a",
                href: "https://www.kommunalteknikk.no/",
                children: ["https://www.kommunalteknikk.no/"],
              },
            ],
          },
        ],
        location: {
          address: null,
          nameOfLocation: "Blank, Torggata 15",
        },
        main: null,
        program: [
          {
            description: "Croissanter og kaffe",
            time: "08:00",
          },
          {
            description: "Dario og Cornelia prater",
            time: "08:30",
          },
          {
            description: "Q&A",
            time: "09:00",
          },
          {
            description: "Mer croissanter og kaffe",
            time: "09:15",
          },
          {
            description: "Dørene stenger",
            time: "10:00",
          },
        ],
        series: "kjoregaar",
        signupLink:
          "https://www.eventbrite.com/e/kjregar-007-case-study-byggesakai-tickets-760308502197?aff=oddtdtcreator",
        signupOpen: true,
        signupOpens: "2023-11-16T09:08:00.000Z",
        speakers: [
          {
            name: "Cornelia Schmitt",
            roles: ["Designer"],
            speakerImage: {
              _ref: "/public/images/b017beeb99fa98f33e41d4a3680b4ddaa299c928-860x573.webp",
              _type: "file",
              metadata: {
                width: 860,
                height: 573,
                sha256:
                  "71141cf1f3a18d7d85f88d816b559a1e05333bde5ca81638ecb2d8b2d977cbfb",
                mimeType: "image/webp",
              },
            },
          },
          {
            name: "Dario Sučić",
            roles: ["Teknolog"],
            speakerImage: {
              _ref: "/public/images/508a89cc1c2121d547d1956dd25dce1273de3189-860x571.webp",
              _type: "file",
              metadata: {
                width: 860,
                height: 571,
                sha256:
                  "c24dede381e4530abe4c78701d53703421a27c6340720880021da9d53e508a52",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Case study: byggesak.ai",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription: null,
        metadataTitle: "Case study: byggesak.ai",
      },
      hakimaki: {
        date: "2024-01-26T07:00:00.000Z",
        eventFull: false,
        eventImage: {
          _ref: "/public/images/4b82fae4e99bade4c324455d30b7efe087a2e1b1-4006x2246.webp",
          _type: "file",
          metadata: {
            width: 4006,
            height: 2246,
            sha256:
              "f4d3b8a7d80e45a503413414a85ef2415bd7aa211d81778f8f9011bc24df3d63",
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Hakimaki will show how they work from idea to object when making inventions and set pieces in the intersection of design, art and technology.",
            ],
          },
          {
            tag: "p",
            children: [
              "To illustrate their process they will talk about the making of the Volkswagen office chair, an electric vehicle that goes 19 kmh with a 12 km range. They will also speak about the making of a marble computer for a Paris museum.",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: ["Torggata 15"],
            },
          ],
          nameOfLocation: "Blank",
        },
        main: [
          {
            tag: "p",
            children: [
              "Hakimaki is the design studio / workshop of Martin Gautron and Stian Korntved Ruud undertaking projects from concept to reality. With a process-oriented methodology they make custom objects, installations, machines, models and prototypes for museums, cineasts, architects, and researchers to bring ideas to life.",
            ],
          },
        ],
        program: [
          {
            description: "Croissanter og kaffe",
            time: "08:00",
          },
          {
            description: "Presentation: From idea to object",
            time: "08:30",
          },
          {
            description: "Q&A",
            time: "09:15",
          },
          {
            description: "Mer kaffe?",
            time: "09:30",
          },
          {
            description: "Dørene lukkes",
            time: "10:00",
          },
        ],
        series: "kjoregaar",
        signupLink:
          "https://www.eventbrite.com/e/kjregar-008-from-idea-to-object-tickets-796758454987",
        signupOpen: true,
        signupOpens: "2024-01-17T09:09:00.000Z",
        speakers: [
          {
            name: "Martin Gautron",
            roles: null,
            speakerImage: {
              _ref: "/public/images/4b82fae4e99bade4c324455d30b7efe087a2e1b1-4006x2246.webp",
              _type: "file",
              metadata: {
                width: 4006,
                height: 2246,
                sha256:
                  "f4d3b8a7d80e45a503413414a85ef2415bd7aa211d81778f8f9011bc24df3d63",
                mimeType: "image/webp",
              },
            },
          },
          {
            name: "Stian Korntved Ruud",
            roles: null,
            speakerImage: {
              _ref: "/public/images/4b82fae4e99bade4c324455d30b7efe087a2e1b1-4006x2246.webp",
              _type: "file",
              metadata: {
                width: 4006,
                height: 2246,
                sha256:
                  "f4d3b8a7d80e45a503413414a85ef2415bd7aa211d81778f8f9011bc24df3d63",
                mimeType: "image/webp",
              },
            },
          },
        ],
        title: "Hakimaki: From idea to object",
        typeformId: null,
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription:
          "Hakimaki will show how they work from idea to object when making inventions and set pieces in the intersection of design, art and technology.\n\nTo illustrate their process they will talk about the making of the Volkswagen office chair, an electric vehicle that goes 19 kmh with a 12 km range. They will also speak about the making of a marble computer for a Paris museum.\n\n(The presentation will be given in english)",
        metadataTitle: "Hakimaki: From idea to object",
      },
      studentfest2024: {
        date: "2024-06-25T15:00:00.000Z",
        eventFull: true,
        eventImage: {
          _ref: "/public/studentfest_2024_af4e0.webp",
          _type: "file",
          metadata: {
            sha256:
              "af4e0e503e05a3d7446ab6ca2dda38d8daf4c8ddf766292afcc6f4f2f47b4362",
            width: 3750,
            height: 1875,
            mimeType: "image/webp",
          },
        },
        introduction: [
          {
            tag: "p",
            children: [
              "Vi inviterer dere som studerer teknologi eller design til å besøke oss på loftet vårt tirsdag 25. juni 🎉",
            ],
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: [
                {
                  tag: "a",
                  href: "https://goo.gl/maps/GLURauoXQKKWPB9S8",
                  children: ["Torggata 15, 0971 Oslo"],
                },
              ],
            },
          ],
          nameOfLocation: "Blank",
        },
        main: [
          {
            tag: "p",
            children: [
              "Vi serverer litt mat klokken 17, og ellers snacks og valgfri drikke hele kvelden.\n    Meld deg på via skjemaet her på siden.\n    ",
              {
                tag: "br",
              },
              {
                tag: "br",
              },
              "\n    Velkommen til oss!\n    ",
              {
                tag: "br",
              },
              {
                tag: "br",
              },
              "\n    PS: Alle studenter er invitert, og ta gjerne med en venn, uvenn eller kollega hvis du vil det.",
            ],
          },
        ],
        program: [
          {
            description: "Dørene åpnes",
            time: "17:00",
          },
          {
            description: "Dørene lukkes",
            time: "23:59",
          },
        ],
        series: "fest",
        signupLink: null,
        typeformId: "nIbBBdaD",
        signupOpen: null,
        signupOpens: null,
        speakers: [],
        title: "Studentfest 2024",
        eventbriteEventId: null,
        eventbriteUrl: null,
        metadataDescription:
          "Vi inviterer dere som studerer teknologi eller design til å besøke oss på loftet vårt tirsdag 25. juni :tada:",
        metadataTitle: "Studentfest 2024",
      },
      "ai-act": {
        date: "2024-08-23T06:00:00.000Z",
        main: [
          {
            tag: "p",
            children: [
              "Christoffer Johnsen er senioradvokat hos Ræder Bing, og bistår en rekke virksomheter med å navigere komplekse regulatoriske landskap knyttet til digital innovasjon. Christoffer er en ettertraktet foredragsholder på konferanser og underviser jevnlig på Universitetet i Oslo og Høyskolen Kristiania.",
            ],
          },
        ],
        title: "Intro til AI Act",
        series: "kjoregaar",
        program: [
          {
            description: "Croissanter og kaffe",
            time: "08:00",
          },
          {
            description: "Foredrag: Intro til AI Act",
            time: "08:30",
          },
          {
            description: "Q&A",
            time: "09:15",
          },
          {
            description: "Mer kaffe?",
            time: "09:30",
          },
          {
            description: "Dørene lukkes",
            time: "10:00",
          },
        ],
        location: {
          address: [
            {
              tag: "p",
              children: ["Torggata 15, 0181 Oslo"],
            },
          ],
          nameOfLocation: "Blank",
        },
        speakers: [
          {
            name: "Christoffer Johnsen",
            roles: ["Senioradvokat"],
            speakerImage: {
              _ref: "/public/cjo_56e9e.jpg",
              _type: "file",
              metadata: {
                width: 570,
                height: 392,
                sha256:
                  "56e9e3ef546cec534c648c7fcb5e15ac136824e5addb1183ab7345ad9a72ebd5",
                mimeType: "image/jpeg",
              },
            },
          },
        ],
        eventFull: false,
        eventImage: {
          _ref: "/public/eu-ai-act-title-1200x686_ce141.png",
          _type: "file",
          metadata: {
            width: 1200,
            height: 686,
            sha256:
              "ce141dc2d02419822646ec4459a4f0ed016f948653efcf651501f26e576a64c8",
            mimeType: "image/png",
          },
        },
        signupLink:
          "https://www.eventbrite.com/e/kjregar-009-intro-til-ai-act-tickets-988610228807",
        signupOpen: true,
        typeformId: null,
        signupOpens: null,
        introduction: [
          {
            tag: "p",
            children: [
              "I dette foredraget vil Christoffer Johnsen gi en oversikt over AI Act, EUs kommende regulering for kunstig intelligens. Han vil dekke de viktigste aspektene av den nye lovgivningen, inkludert klassifisering av ulike AI-systemer, samt hvordan virksomheter kan forberede seg på å etterleve de nye reglene. Christoffer vil også dele praktiske eksempler for å gjøre de nye kravene forståelige og anvendelige i praksis.",
            ],
          },
        ],
        eventbriteUrl: null,
        metadataTitle: null,
        eventbriteEventId: null,
        metadataDescription: null,
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          title: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          date: {
            type: "string",
            options: {},
            opt: false,
            raw: true,
          },
          introduction: {
            type: "richtext",
            opt: false,
            options: {
              style: {
                bold: true,
                italic: true,
                lineThrough: true,
              },
              block: {
                h1: true,
                h2: true,
                h3: true,
                h4: true,
                h5: true,
                h6: true,
                ul: true,
                ol: true,
              },
              inline: {
                a: true,
                img: true,
              },
            },
          },
          metadataDescription: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          metadataTitle: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          main: {
            type: "richtext",
            opt: true,
            options: {
              style: {
                bold: true,
                italic: true,
                lineThrough: true,
              },
              block: {
                h1: true,
                h2: true,
                h3: true,
                h4: true,
                h5: true,
                h6: true,
                ul: true,
                ol: true,
              },
              inline: {
                a: true,
                img: true,
              },
            },
          },
          eventFull: {
            type: "boolean",
            opt: false,
          },
          eventImage: {
            type: "image",
            opt: false,
          },
          location: {
            type: "object",
            items: {
              address: {
                type: "richtext",
                opt: true,
                options: {
                  style: {
                    bold: true,
                    italic: true,
                    lineThrough: true,
                  },
                  block: {
                    h1: true,
                    h2: true,
                    h3: true,
                    h4: true,
                    h5: true,
                    h6: true,
                    ul: true,
                    ol: true,
                  },
                  inline: {
                    a: true,
                    img: true,
                  },
                },
              },
              nameOfLocation: {
                type: "string",
                options: {},
                opt: false,
                raw: false,
              },
            },
            opt: false,
          },
          program: {
            type: "array",
            item: {
              type: "object",
              items: {
                description: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: false,
                },
                time: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: true,
                },
              },
              opt: false,
            },
            opt: false,
          },
          series: {
            type: "keyOf",
            path: "/content/events/series.val.ts",
            schema: {
              type: "record",
              item: {
                type: "object",
                items: {
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: false,
            values: "string",
          },
          signupLink: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          typeformId: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          signupOpen: {
            type: "boolean",
            opt: true,
          },
          signupOpens: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          speakers: {
            type: "array",
            item: {
              type: "object",
              items: {
                name: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: false,
                },
                roles: {
                  type: "array",
                  item: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  opt: true,
                },
                speakerImage: {
                  type: "image",
                  opt: false,
                },
              },
              opt: false,
            },
            opt: false,
          },
          eventbriteEventId: {
            type: "number",
            opt: true,
          },
          eventbriteUrl: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/pages/positions.val.ts": {
    source: {
      student: {
        applyUrl: "https://blankno.recruitee.com",
        contact: 3,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Oppstart 7. august 2023"],
                  },
                  ". Det starter med to uker kick off, etter dette vil du jobbe circa en dag i uka, med fleksibel arbeidstid- og sted. Høstjobben varer minst frem til jul, med mulighet for forlengelse mot sommeren 2024.",
                  {
                    tag: "br",
                  },
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Søknadsfrist mandag 27. februar 2023"],
                  },
                ],
              },
            ],
            title: "Hvor og når?",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Blank er et design- og teknologimiljø i Oslo som utvikler produkter og tjenester for kunder, i tillegg til at vi bygger ting selv. Vi skal nå lage enda flere egne greier og ser etter studenter som har lyst til å være med på produktutviklingen helt fra starten.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Sammen med deg og de andre høststudentene skal vi bygge et helt nytt digitalt produkt. Ikke bare fordi det er gøy (det er det), men også fordi vi tror vi har en idé som vil løse problemer for folk. Om vi lykkes og det blir et eget produktselskap vil du også få en eierandel i dette.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Vi tror høsten ser cirka slik ut"],
                  },
                ],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "To-ukers oppstart hos Blank ved Youngstorget i Oslo",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "En dag i uken gjennom høsten - enten på kontoret til Blank eller remote",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "To fellessamlinger i Oslo (dato tbd.) hvor Blank betaler reise og opphold",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du er design- eller teknologistudent som begynner på 4. eller 5. året høsten 2023. Du bør være naturlig nysgjerrig og ønsker å utfordre deg selv. Du synes det er spennende med digital produktutvikling og liker å bygge ting sammen med andre. Du er ivrig etter å teste idéer og konsepter.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Er du designer"],
                  },
                  " ønsker vi at du liker å designe digitale prototyper, teste og evaluere. Du håndterer å ta egne valg basert på eksisterende innsiktsarbeid.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Er du teknolog"],
                  },
                  " ønsker vi at du har praktisk erfaring med å bygge applikasjoner.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Du bør ha mulighet til å være fysisk tilstede i to oppstartsuker i August. Vi kan tilpasse oss for at det ikke skal kræsje med skolestart og sommerjobb. Vi finner ut av det!",
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: {
              text: "Søk nå!",
              type: "primary",
              url: "https://blankno.recruitee.com",
            },
          },
        ],
        header: "Deltidsjobb for studenter",
        image: {
          _ref: "/public/images/f674e74548ccb0af57c8c8d3d8246fc9c6e1e22d-1129x627.webp",
          _type: "file",
          metadata: {
            width: 1129,
            height: 627,
            sha256:
              "c19f7db2d3f9412c906f4551439077591506e38d85d5205002e2429f38b5b84c",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "I Blank liker vi å lage våre egne greier. Bli med å designe og utvikle et helt nytt digitalt produkt høsten 2023.",
            ],
          },
        ],
        section: 0,
        theme: "dark",
        metadataIntro: null,
      },
      "nyutdannet-designer": {
        applyUrl:
          "https://blankno.recruitee.com/o/nyutdannede-designer-2024/c/new",
        contact: 3,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi i Blank designer og utvikler digitale tjenester. Vi jobber med en kombinasjon av start-ups, små og store virksomheter, og i tillegg utvikler vi egne produkter og tjenester når vi kommer på noe bra – mest fordi vi synes det er gøy. En av disse tjenestene er nå et eget firma med 14 ansatte 🎉",
                ],
              },
              {
                tag: "p",
                children: [
                  "Du kan ",
                  {
                    tag: "a",
                    href: "https://blogg.blank.no/tagged/whatitdo",
                    children: [
                      "se noen eksempler på ting vi jobber med på bloggen",
                    ],
                  },
                  ", som Amoi, ice, Karpe, Reisen til Spektrum (Sondre Justad), Aneo og reMarkable. Tre år på rad er også tjenester Blank har utviklet blitt nominert til Gulltaggen.",
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi har blant annet satt av første fredag i måneden til innedag, en hel dag der du kan lære deg nye ting eller bli enda bedre på ting du allerede kan. I tillegg til dette kan du selvfølgelig dra på konferanser og kurs når ",
                  {
                    tag: "span",
                    styles: ["italic"],
                    children: ["du"],
                  },
                  " mener det er en god ide.",
                ],
              },
            ],
            title: "Faglig utvikling",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du bør være trygg på de prosessene og metodene du trenger til å løse kundenes utfordringer, og du bør ha en trang til å utforske, undersøke og drive fagfeltet vårt fremover. Vi tror på styrken i dybde og mangfold og er ikke interessert i å ansette mer av oss selv. Vi ønsker å bli utfordret, og at du trekker oss i nye retninger.",
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du er nysgjerrig, motivert og selvdreven, fordi vi stoler på deg og gir deg tillit til å kjøre på!",
                ],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må være dyktig til å kommunisere både visuelt og muntlig, fordi det er viktig å kunne overbevise folk om at det du har laget er en sjukt god idé.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må ha grundig forståelse for designprosess og metodikk, fordi… les punktet over.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må trives med å lede designprosesser fra start til slutt, fordi samskaping er en viktig del av å være designer.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må ønske å ta faglig ansvar, både internt og på prosjekt, fordi vi selger kunnskap og da må vi lære noe nytt hele tiden.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Hvis du ikke kan krysse av på alle punktene, stryker du dem og fyller på med noen egne!",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "og ellers...",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Oppstart august 2025"],
                  },
                  ". ",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Det starter med to uker onboarding, etter dette er målet at du går direkte ut i prosjekt sammen med andre fra Blank.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi forventer at intervjuene vil skje mellom 15 -19 juli.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Søknadsfrist 1. juli 2024"],
                  },
                ],
              },
            ],
            title: "Hvor og når?",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Blank har en todelt prosess for designere. Hvor vi i første del gjør et dypdykk i din CV og portefølje. Og du får også en caseoppgave tre dager før intervjuet som du skal presentere ditt løsningsforslag på.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "De kandidatene som går videre får del to av caseoppgave, også denne tre dager før andre og siste intervjurunde.",
                ],
              },
            ],
            title: "Søknadsprosess",
            button: {
              text: "Vår intervjuprosess",
              type: "secondary",
              url: "https://www.blank.no/jobb/intervjueprosess-design",
            },
          },
        ],
        header: "Nyutdannet interaksjonsdesigner 2025",
        image: {
          _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
          _type: "file",
          metadata: {
            width: 1920,
            height: 1281,
            sha256:
              "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Vi har startet å lete etter nyutdannede interaksjonsdesignere for oppstart i 2025. ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Mange av dere som har sommerjobber i juli vil få tilbud derfra i sommer. Ønsker du også en mulighet til å søke hos oss før du må svare på et tilbud fra sommerjobben, da kan du gjøre det nå frem til 1. juli.",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "span",
                styles: ["bold"],
                children: ["Søknadsfrist 1. juli 2024!"],
              },
            ],
          },
        ],
        section: 1,
        theme: "dark",
        metadataIntro: null,
      },
      "intervjueprosess-design": {
        applyUrl: "https://blankno.recruitee.com/o/designer/",
        contact: 3,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Send oss en søknad hvor du beskriver hvem du er som designer, hva som motiverer deg til å søke hos Blank og gjerne litt om hva du kan tenke deg å jobbe med (om du vet det).",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi ønsker oss en rett frem og enkel CV, bruk gjerne en Word-mal til dette. Vi leser mange CV’er og det hjelper oss veldig at disse ikke avviker fra standarden. Legg heller designkruttet ditt i porteføljen.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Porteføljen bør inneholde masse gode bilder av hva du har skapt som designer, vi vil også se konkrete eksempler på din design prosess. Om du har lyst til å kline til sleng gjerne med hvilken effekt designet du skapte hadde!",
                ],
              },
            ],
            title: "Du søker - vi lover at du hører fra oss!",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Blir du invitert til et intervju, får du en caseoppgave tre dager før intervjuet. Hvordan du bruker tiden er opp til deg.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Her ønsker vi å få et innblikk i hvordan du tar valg, strukturerer din prosess og jobber med prosess som designer.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Dette er en oppgave for å ha noe å snakke omkring og gi struktur til en dialog med oss om dine designferdigheter.",
                ],
              },
            ],
            title: "Første caseoppgave - du tenker litt",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du møter vanligvis to designere fra Blank og det varer i ca. 90 minutter. Vi starter med en gjennomgang av din portefølje og CV, vi vil se hvem du er som designer, hva du liker å drive med og hva som driver deg.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Deretter presenterer du caseoppgaven din, tenk at vi er kunden. Etterpå ønsker vi en diskusjonsbasert og ganske uformell dialog om din løsning.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Målet er å forstå dine refleksjoner og erfaringer, så vi spør og graver. Vi ser ikke etter «riktige» svar, men er mer nysgjerrig på hvordan du tenker.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Til slutt får du godt med tid til å spørre oss om det du måtte lure på, hvor vi kan fortelle om hvordan det er å være designer i Blank, hvordan vi liker å jobbe og hvordan vi har det hos kundene våre.",
                ],
              },
            ],
            title: "1 - Første intervju - Vi blir litt kjent",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Går du videre etter første intervju, vil du motta den andre delen av caseoppgaven tre dager før andre intervju. I denne oppgaven er vi ute etter å se mer av ditt håndverk som designer, hvordan du bygger og designer konkrete løsninger, og hvordan du vurderer ditt eget design fortløpende.",
                ],
              },
            ],
            title: "Andre caseoppgave - du tenker litt mer",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Som oftest er det to designere fra Blank, hvor designleder Jon Bernholdt alltid er med. Det varer vanligvis i 90 minutter.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Her er det caseoppgaven som er hovedfokus og vi ønsker igjen at du presenterer den som om vi er kunden, før vi diskuterer løsningen og hvordan du har jobbet den frem.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Det er ganske vanlig at Jon også ønsker å ta en titt på porteføljen og snakke seg litt gjennom den med deg.",
                ],
              },
            ],
            title: "2 - Andre intervju - Du blir kjent med flere av oss",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Føler vi oss trygge på at du kan være et bra tilskudd for Blank og at du kommer til å trives sammen med oss vil vi gi deg et tilbud.",
                ],
              },
              {
                tag: "p",
                children: ["Her håper vi jo såklart at du velger oss!"],
              },
            ],
            title: "3 - Vi sender deg et tilbud",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Når du har signert pleier vi ganske kjapt å invitere deg til Slack og alt av sosiale ting, sånn at du får muligheten til å se og bli kjent med folk!",
                ],
              },
            ],
            title: "4 - Signering",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du møter daglig leder Jahn Arne og går gjennom detaljene.",
                ],
              },
            ],
            title: "Kontraktsmøte",
            button: {
              text: "Søk nå!",
              type: "primary",
              url: "https://blankno.recruitee.com/o/designer/",
            },
          },
        ],
        header: "Slik er vår intervjueprosess for designere",
        image: {
          _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
          _type: "file",
          metadata: {
            width: 1920,
            height: 1281,
            sha256:
              "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Send oss en søknad hvor du beskriver hvem du er som designer, hva som motiverer deg til å søke hos Blank og gjerne litt om hva du kan tenke deg å jobbe med (om du vet det).",
            ],
          },
          {
            tag: "p",
            children: [
              "Vi ønsker oss en rett frem og enkel CV, bruk gjerne en Word-mal til dette. Vi leser mange CV’er og det hjelper oss veldig at disse ikke avviker fra standarden. Legg heller designkruttet ditt i porteføljen.",
            ],
          },
          {
            tag: "p",
            children: [
              "Porteføljen bør inneholde masse gode bilder av hva du har skapt som designer, vi vil også se konkrete eksempler på din design prosess. Om du har lyst til å kline til sleng gjerne med hvilken effekt designet du skapte hadde!",
            ],
          },
        ],
        section: 2,
        theme: "dark",
        metadataIntro: null,
      },
      "nyutdannet-teknolog": {
        applyUrl:
          "https://blankno.recruitee.com/o/nyutdannet-teknolog-2025/c/new",
        contact: 2,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi i Blank designer og utvikler digitale tjenester. Vi jobber med en kombinasjon av start-ups, små og store virksomheter, og i tillegg utvikler vi egne produkter og tjenester når vi kommer på noe bra – mest fordi vi synes det er gøy. En av disse tjenestene er nå et eget firma med 14 ansatte 🎉  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Du kan ",
                  {
                    tag: "a",
                    href: "https://blogg.blank.no/tagged/whatitdo",
                    children: [
                      "se noen eksempler på ting vi jobber med på bloggen",
                    ],
                  },
                  ", som Amoi, ice, B-Boy Myhre, Reisen til Spektrum (Sondre Justad), Aneo og reMarkable. Tre år på rad er også tjenester Blank har utviklet blitt nominert til Gulltaggen.",
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi har blant annet satt av første fredag i måneden til innedag, en hel dag der du kan lære deg nye ting eller bli enda bedre på ting du allerede kan. I tillegg til dette kan du selvfølgelig dra på konferanser og kurs når ",
                  {
                    tag: "span",
                    styles: ["italic"],
                    children: ["du"],
                  },
                  " mener det er en god ide.",
                ],
              },
            ],
            title: "Faglig utvikling",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du bør være en selvdreven person som takler at vi er i utvikling. Du bør være trygg på egne ferdigheter, du bør ha en trang til å utforske og undersøke, og du må kunne være med å drive fagfeltet vårt fremover.",
                ],
              },
              {
                tag: "p",
                children: ["Og ellers..."],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Vi håper du er nysgjerrig, motivert og selvdreven – fordi vi stoler på deg og gir deg tillit til å kjøre på!",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må ønske å ta faglig ansvar, både internt og på prosjekt, fordi vi selger kunnskap og da må vi lære noe nytt hele tiden.",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Oppstart august 2025"],
                  },
                  ".",
                ],
              },
              {
                tag: "p",
                children: [
                  "Det starter med to uker onboarding, etter dette er målet at du går direkte ut i prosjekt sammen med andre fra Blank.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi forventer at første runde intervjuer vil skje mellom 15. - 19. juli.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                  {
                    tag: "span",
                    styles: ["bold"],
                    children: ["Søknadsfrist mandag 1. juli 2024"],
                  },
                ],
              },
            ],
            title: "Hvor og når?",
            button: null,
          },
          {
            text: [
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Første steg i prosessen er en kodequiz som vi sender deg kort tid etter du sendte inn søknaden din. Sammen med CV og resultatet av kodequiz kommer vi til å ta en vurdering om vi inviterer deg videre til neste intervjurunde.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "I det første intervjuet forteller vi om Blank og prater om dine spørsmål, du forteller om dine prosjekterfaringer og hva du ønsker å jobbe med. Intervjuet kommer til å ta litt over en time.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Siste steg i prosessen er et programmeringsintervju. Du kommer til å sitte sammen med en av oss og prøve å løse en programmeringsoppgave. Dette tar ca 2 timer.",
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "Vurderingen om du kommer videre til første intervjurunden skjer etter at søknadsfristen har utløpet, men send Clara gjerne en e-post om du trenger en raskere søknadsprosess.",
                ],
              },
            ],
            title: "Søknadsprosess",
            button: {
              text: "Søk nå!",
              type: "secondary",
              url: "https://blankno.recruitee.com/o/nyutdannet-teknolog-2025",
            },
          },
        ],
        header: "Nyutdannet teknolog 2025",
        image: {
          _ref: "/public/images/f674e74548ccb0af57c8c8d3d8246fc9c6e1e22d-1129x627.webp",
          _type: "file",
          metadata: {
            width: 1129,
            height: 627,
            sha256:
              "c19f7db2d3f9412c906f4551439077591506e38d85d5205002e2429f38b5b84c",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Vi har startet å lete etter nyutdannede teknologer for oppstart i august 2025. ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "For å gi dere som får tilbud i forbindelse med sommerjobb muligheten til å søke, har vi satt ",
              {
                tag: "span",
                styles: ["bold"],
                children: ["søknadsfristen til 1. juli"],
              },
              ".",
            ],
          },
        ],
        section: 1,
        theme: "dark",
        metadataIntro: null,
      },
      teknolog: {
        applyUrl: "https://blankno.recruitee.com/o/teknolog/c/new",
        contact: 0,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Hos oss skal folk ha god lønn og rettferdige betingelser. For å gjøre det enkelt har vi lagt ut både prinsipper og detaljer på ",
                  {
                    tag: "a",
                    href: "https://www.blank.no/betingelser",
                    children: ["https://www.blank.no/betingelser"],
                  },
                  ".",
                ],
              },
            ],
            title: "Lønn og betingelser",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Som teknolog i Blank jobber du sammen med andre designere og teknologer i relativt små team. Mye av tiden bruker du på å lære deg nye ting eller til å bli enda råere på ting du allerede kan. Noen av kundene våre er Amoi, Aidn, Aneo, Autodesk, ice, reMarkable, Ruter, Stortinget og NRK. Vi jobber også med startups som gir gass, og sikkert blir like kjente om ei litta stund. Egne digitale tjenester lager vi også, mest fordi vi har lyst og kan.",
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du har minst tre års erfaring som utvikler.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du er nysgjerrig, motivert og selvdreven, fordi vi stoler på deg og gir deg tillit til å bare gønne på!",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du tenner på å ta faglig ansvar, både internt og hos kunde. Vi selger kunnskap og det som er inni hjernen vår, og da må vi lære noe nytt hele tiden.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Det er helt prima om du har relevant utdanning på CV-en, men det er ikke et krav. Så lenge du tikker av de fleste boksene gjennom rekrutteringen vår, holder det for oss!",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: {
              text: "Søk nå!",
              type: "primary",
              url: "https://blankno.recruitee.com/o/teknolog/c/new",
            },
          },
        ],
        header: "Bli teknolog i Blank",
        image: {
          _ref: "/public/images/c0bf1dbf3cf1e5eb18c4b8f42393d1c773be2074-3008x1692.webp",
          _type: "file",
          metadata: {
            width: 3008,
            height: 1692,
            sha256:
              "73f7fff05325c61e5fb2bbc34045b30020eed0851ae9db57c0900022a1ef9bf9",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Vi liker folk som tør, og som koser seg med å løse skikkelige problemer. Det kalles også for engasjerte og ambisiøse utviklere. Vi har dem, men trenger likevel flere!",
            ],
          },
        ],
        section: 2,
        theme: "dark",
        metadataIntro:
          "Vi liker folk som tør, og som koser seg med å løse skikkelige problemer. Det kalles også for engasjerte og ambisiøse utviklere. Vi har dem, men trenger likevel flere!",
      },
      "senior-designer": {
        applyUrl: "https://blankno.recruitee.com/o/designer/",
        contact: 1,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du vil jobbe med design av digitale produkter og tjenester, og du vil bruke mye tid på lære deg nye ting eller bli enda bedre på ting du allerede kan. Vi i Blank jobber med kjente merkevarer som Amoi, Aidn, ice, reMarkable, NRK, Finn.no, Inspera, og vi jobber med startups som kanskje vil bli like kjente om en stund. I tillegg lager vi egne digitale tjenester – mest fordi vi har lyst.",
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi tror på å gi folk god lønn og rettferdige betingelser. For å gjøre det enkelt har vi lagt ut både prinsipper og detaljer på ",
                  {
                    tag: "a",
                    href: "https://www.blank.no/betingelser",
                    children: ["blank.no/betingelser"],
                  },
                ],
              },
            ],
            title: "Lønn og betingelser",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du bør være trygg på de prosessene og metodene du trenger til å løse kundenes utfordringer, og du bør ha en trang til å utforske, undersøke og drive fagfeltet vårt fremover. Vi tror på styrken i dybde og mangfold og er ikke interessert i å ansette mer av oss selv. Vi ønsker å bli utfordret, og at du trekker oss i nye retninger.",
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: null,
          },
          {
            text: [
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du er nysgjerrig, motivert og selvdreven, fordi vi stoler på deg og gir deg tillit til å kjøre på!",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må være dyktig til å kommunisere både visuelt og muntlig, fordi det er viktig å kunne overbevise folk om at det du har laget er en sjukt god idé.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må ha grundig forståelse for designprosess og metodikk, fordi… les punktet over.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må trives med å lede designprosesser fra start til slutt, fordi samskaping er en viktig del av å være designer.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du må ønske å ta faglig ansvar, både internt og på prosjekt, fordi vi selger kunnskap og da må vi lære noe nytt hele tiden.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Hvis du ikke kan krysse av på alle punktene, stryker du dem og fyller på med noen egne!",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Og ellers...",
            button: {
              text: "Søk nå!",
              type: "primary",
              url: "https://blankno.recruitee.com/o/designer/",
            },
          },
        ],
        header: "Bli senior designer i Blank",
        image: {
          _ref: "/public/images/ab527c566aff209cfbc97083b28392c042fc5ae4-1440x811.webp",
          _type: "file",
          metadata: {
            width: 1440,
            height: 811,
            sha256:
              "9d8a816e9d9a6f9d95dbca633d5666936b59043be4440742f52a410be6bae332",
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Bli med i et prisvinnende fagmiljø av digitale designere som setter agendaen innen digital tjenesteutvikling.",
            ],
          },
        ],
        section: 2,
        theme: "dark",
        metadataIntro:
          "Bli med i et prisvinnende fagmiljø av digitale designere som setter agendaen innen digital tjenesteutvikling.",
      },
      designer: {
        applyUrl: "https://blankno.recruitee.com/o/designer/c/new",
        contact: 1,
        details: [
          {
            text: [
              {
                tag: "p",
                children: [
                  "Hos oss skal folk få god lønn og rettferdige betingelser. For å gjøre det enkelt har vi lagt ut både prinsipper og detaljer på ",
                  {
                    tag: "a",
                    href: "https://www.blank.no/betingelser",
                    children: ["blank.no/betingelser"],
                  },
                  ".",
                ],
              },
            ],
            title: "Lønn og betingelser",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Som designer i Blank vil du selvfølgelig jobbe med design av digitale produkter og tjenester. Mye av arbeidstiden din vil også gå til å lære deg nye ting eller å bli enda bedre på ting du allerede kan. Sånn har vi blitt et prisvinnende fagmiljø innen design.",
                ],
              },
            ],
            title: "Dette vil du jobbe med",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Vi jobber med ",
                  {
                    tag: "a",
                    href: "https://www.blank.no/prosjekter",
                    children: ["kunder"],
                  },
                  " som reMarkable, Amoi, Aidn, ice, NRK, Ruter og Finn. Vi jobber også med ivrige startups, som sikkert blir like kjente som de andre merkevarene om ei litta stund. Egne digitale produkter lager vi også, mest fordi vi har lyst og kan.",
                ],
              },
            ],
            title: "Kunder",
            button: null,
          },
          {
            text: [
              {
                tag: "p",
                children: [
                  "Du bør hige etter å utforske, undersøke og drive fagfeltet vårt fremover. Like mye bør du være trygg på de prosessene og metodene du trenger til å løse kundenes problemer.",
                ],
              },
              {
                tag: "p",
                children: [
                  {
                    tag: "br",
                  },
                ],
              },
              {
                tag: "p",
                children: [
                  "I våre oppdrag tar vi ansvar for hele designprosessen, så du må både være god på å forstå problemet som skal løses, og på å finne, designe, prototype og evaluere løsningen.",
                ],
              },
              {
                tag: "p",
                children: [
                  "Les mer om hvordan ting funker i Blank i ",
                  {
                    tag: "a",
                    href: "https://www.blank.no/handboka",
                    children: ["Håndboka"],
                  },
                ],
              },
            ],
            title: "Dette ønsker vi fra deg",
            button: null,
          },
          {
            text: [
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Minst 3 års erfaring med design av digitale produkter og tjenester.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du klarer å definere problemene som skal løses for kundene, i tillegg til å detaljere hvordan løsningen ser ut og skal oppføre seg.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du koser deg med å lede designprosesser fra start til slutt, og skjønner at det å lage noe på tvers av fagdisipliner er en viktig del av å være designer.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du er nysgjerrig, motivert og selvdreven, det ække noe å lure på engang.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du er god til å kommunisere – både visuelt og muntlig.",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du har grundig forståelse for designprosess og metodikk",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Du tenner på å ta faglig ansvar, både internt og hos kunden. Vi selger kunnskap, og da må vi lære hele tiden.",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Og ellers, da?",
            button: {
              text: "Søk nå!",
              type: "primary",
              url: "https://blankno.recruitee.com/o/designer/c/new",
            },
          },
        ],
        header: "Bli designer i Blank",
        image: {
          _ref: "/public/images/ab527c566aff209cfbc97083b28392c042fc5ae4-1440x811.webp",
          _type: "file",
          metadata: {
            width: 1440,
            height: 811,
            sha256:
              "9d8a816e9d9a6f9d95dbca633d5666936b59043be4440742f52a410be6bae332",
            hotspot: {
              x: 0.5,
              y: 0.4076077473390333,
              width: 1,
              height: 1,
            },
            mimeType: "image/webp",
          },
        },
        intro: [
          {
            tag: "p",
            children: [
              "Bli med i tidenes fagmiljø og sett agendaen for morgendagens digitale produktutvikling!",
            ],
          },
        ],
        section: 2,
        theme: "dark",
        metadataIntro:
          "Bli med i et prisvinnende fagmiljø av digitale designere som setter agendaen innen digital produktutvikling.",
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          header: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          intro: {
            type: "richtext",
            opt: false,
            options: {
              style: {
                bold: true,
                italic: true,
                lineThrough: true,
              },
              block: {
                h1: true,
                h2: true,
                h3: true,
                h4: true,
                h5: true,
                h6: true,
                ul: true,
                ol: true,
              },
              inline: {
                a: true,
                img: true,
              },
            },
          },
          metadataIntro: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          applyUrl: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          contact: {
            type: "keyOf",
            path: "/content/employees/contactEmployees.val.ts",
            schema: {
              type: "array",
              item: {
                type: "object",
                items: {
                  email: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  image: {
                    type: "image",
                    opt: false,
                  },
                  name: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  phoneNumber: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  position: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: false,
            values: "number",
          },
          details: {
            type: "array",
            item: {
              type: "object",
              items: {
                title: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: false,
                },
                text: {
                  type: "richtext",
                  opt: false,
                  options: {
                    style: {
                      bold: true,
                      italic: true,
                      lineThrough: true,
                    },
                    block: {
                      h1: true,
                      h2: true,
                      h3: true,
                      h4: true,
                      h5: true,
                      h6: true,
                      ul: true,
                      ol: true,
                    },
                    inline: {
                      a: true,
                      img: true,
                    },
                  },
                },
                button: {
                  type: "object",
                  items: {
                    text: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                    type: {
                      type: "union",
                      key: {
                        type: "literal",
                        value: "primary",
                        opt: false,
                      },
                      items: [
                        {
                          type: "literal",
                          value: "secondary",
                          opt: false,
                        },
                      ],
                      opt: false,
                    },
                    url: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                  },
                  opt: true,
                },
              },
              opt: false,
            },
            opt: false,
          },
          image: {
            type: "image",
            opt: true,
          },
          section: {
            type: "keyOf",
            path: "/content/benefits.val.ts",
            schema: {
              type: "array",
              item: {
                type: "object",
                items: {
                  image: {
                    type: "image",
                    opt: true,
                  },
                  text: {
                    type: "richtext",
                    opt: true,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: false,
            values: "number",
          },
          theme: {
            type: "union",
            key: {
              type: "literal",
              value: "light",
              opt: false,
            },
            items: [
              {
                type: "literal",
                value: "dark",
                opt: false,
              },
              {
                type: "literal",
                value: "alternatingStartLight",
                opt: false,
              },
              {
                type: "literal",
                value: "alternatingStartDark",
                opt: false,
              },
            ],
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/pages/jobs.val.ts": {
    source: {
      description:
        "Er du designer eller teknolog som snuser på å bytte jobb vil vi gjerne snakke med deg! Vil du prate med oss også?",
      pageElements: [
        {
          type: "textAndImageElement",
          alt: "",
          clickable: false,
          side: false,
          size: "sm",
          image: {
            _ref: "/public/images/dbcb029cf591f7424afeba3f21cbf7f641e704ba-3500x2333.webp",
            _type: "file",
            metadata: {
              width: 3500,
              height: 2333,
              sha256:
                "1d7488b8dbf5583a945817b2d22aefdebdcd9dee0eb4062e6627ed9ee03e1af9",
              mimeType: "image/webp",
            },
          },
          text: [
            {
              tag: "ul",
              children: [
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: [
                        "Utfordrende oppdrag som løser viktige problemer",
                      ],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: ["Tilhørighet i et skarpt fagmiljø"],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: ["Godt arbeidsmiljø med svær takhøyde"],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: ["Tenke og bestemme ting sjæl"],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: [
                        "Bra lønn! Det fortjenter du. ",
                        {
                          tag: "a",
                          href: "https://www.blank.no/betingelser/",
                          children: ["Sjekk selv om du lurer."],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "li",
                  children: [
                    {
                      tag: "p",
                      children: ["Være med å eie sjappa sammen med oss andre"],
                    },
                  ],
                },
              ],
            },
          ],
          title: "I Blank får du:",
        },
      ],
      positions: ["designer", "teknolog"],
      theme: "dark",
      title: "Jobb i Blank",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: true,
          raw: false,
        },
        description: {
          type: "string",
          options: {},
          opt: true,
          raw: false,
        },
        positions: {
          type: "array",
          item: {
            type: "keyOf",
            path: "/content/pages/positions.val.ts",
            schema: {
              type: "record",
              item: {
                type: "object",
                items: {
                  header: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  intro: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                  metadataIntro: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  applyUrl: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  contact: {
                    type: "keyOf",
                    path: "/content/employees/contactEmployees.val.ts",
                    schema: {
                      type: "array",
                      item: {
                        type: "object",
                        items: {
                          email: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          image: {
                            type: "image",
                            opt: false,
                          },
                          name: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          phoneNumber: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          position: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          title: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                        },
                        opt: false,
                      },
                      opt: false,
                    },
                    opt: false,
                    values: "number",
                  },
                  details: {
                    type: "array",
                    item: {
                      type: "object",
                      items: {
                        title: {
                          type: "string",
                          options: {},
                          opt: false,
                          raw: false,
                        },
                        text: {
                          type: "richtext",
                          opt: false,
                          options: {
                            style: {
                              bold: true,
                              italic: true,
                              lineThrough: true,
                            },
                            block: {
                              h1: true,
                              h2: true,
                              h3: true,
                              h4: true,
                              h5: true,
                              h6: true,
                              ul: true,
                              ol: true,
                            },
                            inline: {
                              a: true,
                              img: true,
                            },
                          },
                        },
                        button: {
                          type: "object",
                          items: {
                            text: {
                              type: "string",
                              options: {},
                              opt: false,
                              raw: false,
                            },
                            type: {
                              type: "union",
                              key: {
                                type: "literal",
                                value: "primary",
                                opt: false,
                              },
                              items: [
                                {
                                  type: "literal",
                                  value: "secondary",
                                  opt: false,
                                },
                              ],
                              opt: false,
                            },
                            url: {
                              type: "string",
                              options: {},
                              opt: false,
                              raw: false,
                            },
                          },
                          opt: true,
                        },
                      },
                      opt: false,
                    },
                    opt: false,
                  },
                  image: {
                    type: "image",
                    opt: true,
                  },
                  section: {
                    type: "keyOf",
                    path: "/content/benefits.val.ts",
                    schema: {
                      type: "array",
                      item: {
                        type: "object",
                        items: {
                          image: {
                            type: "image",
                            opt: true,
                          },
                          text: {
                            type: "richtext",
                            opt: true,
                            options: {
                              style: {
                                bold: true,
                                italic: true,
                                lineThrough: true,
                              },
                              block: {
                                h1: true,
                                h2: true,
                                h3: true,
                                h4: true,
                                h5: true,
                                h6: true,
                                ul: true,
                                ol: true,
                              },
                              inline: {
                                a: true,
                                img: true,
                              },
                            },
                          },
                          title: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: false,
                          },
                        },
                        opt: false,
                      },
                      opt: false,
                    },
                    opt: false,
                    values: "number",
                  },
                  theme: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "light",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "dark",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "alternatingStartLight",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "alternatingStartDark",
                        opt: false,
                      },
                    ],
                    opt: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: true,
            values: "string",
          },
          opt: true,
        },
        pageElements: {
          type: "array",
          item: {
            type: "union",
            key: "type",
            items: [
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  keepAspectRatio: {
                    type: "boolean",
                    opt: true,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  type: {
                    type: "literal",
                    value: "singleImageElement",
                    opt: false,
                  },
                  image: {
                    type: "image",
                    opt: false,
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  type: {
                    type: "literal",
                    value: "textElement",
                    opt: false,
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  text: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  type: {
                    type: "literal",
                    value: "textAndImageElement",
                    opt: false,
                  },
                  title: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  text: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                  image: {
                    type: "image",
                    opt: false,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  side: {
                    type: "boolean",
                    opt: true,
                  },
                },
                opt: false,
              },
              {
                type: "object",
                items: {
                  size: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "xs",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "sm",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "md",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "lg",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "xl",
                        opt: false,
                      },
                    ],
                    opt: true,
                  },
                  clickable: {
                    type: "boolean",
                    opt: true,
                  },
                  alt: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  type: {
                    type: "literal",
                    value: "doubleImageElement",
                    opt: false,
                  },
                  image1: {
                    type: "image",
                    opt: false,
                  },
                  image2: {
                    type: "image",
                    opt: false,
                  },
                },
                opt: false,
              },
            ],
            opt: false,
          },
          opt: true,
        },
      },
      opt: false,
    },
  },
  "/content/pages/contactJob.val.ts": {
    source: {
      description:
        "Håper du tar deg tid å fylle ut vårt lille skjema. Da kan vi peke deg i riktig retning, og få til en bra prat.",
      formSuccessHeader: "Takker!",
      formSuccessText:
        "Vi har mottatt det vi trenger. Du hører fra oss når vi får lest litt og kikket i kalenderen.",
      image: {
        _ref: "/public/images/cb70b1782865701fe2d713d94b92d67820cf5036-1104x621.webp",
        _type: "file",
        metadata: {
          width: 1104,
          height: 621,
          sha256:
            "46aeebda1a15b1758206c9d0fcb85c9cccb2a17833467687b9b1cb4eea20dfb2",
          mimeType: "image/webp",
        },
      },
      theme: "dark",
      title: "Kult at du vil ta en prat med oss!",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        description: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        image: {
          type: "image",
          opt: false,
        },
        formSuccessHeader: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        formSuccessText: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/handbook.val.ts": {
    source: {
      chapters: [
        {
          header: "Innhold",
          sections: [
            {
              header: "Intro",
              slug: "intro",
              text: [
                {
                  tag: "p",
                  children: [
                    "Personalhåndboken er ikke ment å være 100 % utfyllende. Har du spørsmål du ikke får svar på her kan du lene deg på følgende:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Be om tilgivelse heller enn tillatelse"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Bruk Blanks penger slik du ville brukt dine egne",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Spør en kollega!"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle ansatte kan foreslå endringer og delta i diskusjoner om våre rutiner og ordninger.",
                  ],
                },
              ],
            },
          ],
          slug: "innhold",
        },
        {
          header: "Oppdrag",
          sections: [
            {
              header: "Kundearbeid",
              slug: "kundearbeid",
              text: [
                {
                  tag: "p",
                  children: [
                    "Alle stillinger i Blank, unntatt daglig leder, salgssjef og kontorsjef, er konsulentstillinger. Det vil si at du bruker mesteparten av tiden din i fakturerbare oppdrag - med å designe eller utvikle digitale tjenester for kundene våre.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Ute i oppdrag jobber du i team med andre fra Blank og / eller fra kunden. Vi stiller høye krav til hvem og hva vi jobber med og oppfordrer alle til å engasjere seg i valg av kunder og oppdrag.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du er ikke selv ansvarlig for å skaffe Blank kunder eller prosjekter, men dersom du har tips eller forslag til aktuelle oppdrag for Blank er det alltid fint.",
                  ],
                },
              ],
            },
            {
              header: "Egne startups",
              slug: "egne-startups",
              text: [
                {
                  tag: "p",
                  children: [
                    "I Blank bygger vi også startups på egenhånd. Er du mellom kundeoppdrag eller ønsker å utforske en idé har du mulighet til å jobbe med noen av våre interne initiativer, eller starte et nytt.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du har selv eierskap til din egen idé og bestemmer selv om du ønsker å ha med Blank i din startup, og evt hvor mye. Resten finner vi ut av sammen.",
                  ],
                },
              ],
            },
            {
              header: "Hvordan vi velger oppdrag",
              slug: "hvordan-vi-velger-oppdrag",
              text: [
                {
                  tag: "p",
                  children: [
                    "Du er med og bestemmer over hvilke prosjekter og kunder du jobber for. Salgsprosessen starter med deg og dine ønsker, og deretter finner vi noe som passer. Før vi går i en dialog med en potensiell ny kunde, avklares det alltid med deg først.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du har alltid rett til å takke nei til engasjementer. Det kan for eksempel være på grunn av en dårlig match på arbeidsoppgaver/kompetanse, tidligere erfaringer med kunde, liten interesse for domenet, osv. Du kan også takke nei til engasjementer på etisk grunnlag – dersom arbeidet strider mot din egen overbevisning – uten at du trenger å forsvare eller forklare det.",
                  ],
                },
              ],
            },
            {
              header: "Salg og bemanning",
              slug: "salg-og-bemanning",
              text: [
                {
                  tag: "p",
                  children: [
                    "Salgs- og bemanningsprosesser i Blank skjer som hovedregel åpent. Hele selskapet kan se hvilke kunder vi er i dialog med og hvilke anbud vi vurderer å svare på. Det gjøres unntak, dersom kunder krever at oppdrag behandles hemmelig.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Som ansatt oppfordres du til å være med og diskutere hvilke kunder som er attraktive for oss å jobbe med, og hvilke som eventuelt ikke er det. Du oppfordres også til å si fra dersom du mener noen av kundene vi får forespørsler fra er problematiske å samarbeide med, for eksempel på grunn av etiske forhold.",
                  ],
                },
              ],
            },
          ],
          slug: "oppdrag",
        },
        {
          header: "Fagutvikling",
          sections: [
            {
              header: "11 innedager i året",
              slug: "11-innedager-i-aaret",
              text: [
                {
                  tag: "p",
                  children: [
                    "Første fredag i hver måned har vi innedag og alle i Blank møtes på loftet. Vi bruker innedagene til fagutvikling. Man styrer selv hva man bruker tiden på, du kan ha selvstudium eller være med i en gjeng. ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Innedagen starter med frokost eller bakst. Vi får litt felles info før vi blir litt bedre kjent med kollegaer gjennom 10x10©-presentasjoner. Deretter har vi en kort check-in før fagutviklingstiden starter. Vi bruker ",
                    {
                      tag: "a",
                      href: "https://trello.com/b/2Pwrza2n/fagutvikling-innedager",
                      children: [
                        {
                          tag: "span",
                          styles: ["italic"],
                          children: ["Trelloboard innedager"],
                        },
                      ],
                    },
                    " til program, organisering og deling.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Tema-innedager"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "To innedager i året kjører vi helt fasiliterte innedager som vi kaller tema-innedag. Da planlegger de fagansvarlige et heldagsprogram med eksterne foredragsholdere, hands-on sessions, paneldebatt og/eller workshops som alle kan delta i.",
                  ],
                },
              ],
            },
            {
              header: "Kjøregår",
              slug: "kjoregar",
              text: [
                {
                  tag: "p",
                  children: [
                    "«Kjøregår» er en serie med åpne foredrag hos Blank, og alle som er nysgjerrige er hjertelig velkommen. Noen ganger starter vi innedagene våre med å invitere folk i og utenfor Blank til foredrag om spennende ting som interesserer oss holdt av noen av oss eller bra folk vi kjenner. Foredrag som har vært:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            '"Fra SAS SKIEN til SAS SPEKTRUM" med Silje Larsen Borgan',
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ['"Når det går riktig feil" med Ida Aalen'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "10x10-presentasjon",
              slug: "10x10-presentasjon",
              text: [
                {
                  tag: "p",
                  children: [
                    "Hver innedag blir noen utvalgte trukket ut til å presentere enten seg selv eller sitt oppdrag. Presentasjonen skal være kort, muntlig og enkel. Formatet er 10 slides hvor du har ca 10 sekunder per slide. Målet er bare at vi skal bli litt mer kjent med deg eller oppdraget du er på. Det kan være så generelt eller spesifikt som du ønsker.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Eksempler på tidligere presentasjoner:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["10 fotballbaner jeg spilte på som barn"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "10 salgstriks fra min historie som juletreselger",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["10 steder jeg har bodd"],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "Gjenger",
              slug: "gjenger",
              text: [
                {
                  tag: "p",
                  children: [
                    "En gjeng organiserer seg selv og jobber sammen i en periode for å lære mer og nye ting. De lager i tillegg noe som andre utenfor kan se/høre/delta på og få utbytte av. To ganger i året viser gjengene fram hva de har gjort.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Man finner info om gjengene på trelloboardet til innedagen. Vil du lage en ny gjeng legger du til et kort i trello med info om målet til gjengen. Vil du være med i en gjeng er det bare å ta kontakt med gjengmedlemmene.",
                  ],
                },
                {
                  tag: "p",
                  children: ["Eksempler:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "FPLbot-gjengen lager en Slack-app for Fantasy Premier League - sjekk den ut ",
                            {
                              tag: "a",
                              href: "https://www.fplbot.app/",
                              children: ["her"],
                            },
                            ".",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Typeteori-gjengen utforsker språk med rike typesystemer.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Pico8-gjengen lager spill med Pico8."],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Info om gjengene finner du på Innedag-trelloen: ",
                    {
                      tag: "a",
                      href: "https://trello.com/b/2Pwrza2n/fagutvikling-innedager",
                      children: ["Trelloboard innedager"],
                    },
                  ],
                },
              ],
            },
            {
              header: "Utedager",
              slug: "utedager",
              text: [
                {
                  tag: "p",
                  children: [
                    "På utedager drar hele Blank på tur sammen et sted i Norden. Da er det litt faglig opplegg, men mest sosialt.",
                  ],
                },
              ],
            },
            {
              header: "Show and tell",
              slug: "showandtell",
              text: [
                {
                  tag: "p",
                  children: [
                    "Med jevne mellomrom møtes designerne og utviklerne på loftet og har show and tell. Ansvaret går på rundgang og fokuset er faglig. Man kan f.eks. få tilbakemeldinger og innspill, fortelle om det man jobber med på oppdrag eller i fagutvikling, ha en workshop eller lignende.",
                  ],
                },
              ],
            },
            {
              header: "Konferanser",
              slug: "konferanser",
              text: [
                {
                  tag: "p",
                  children: [
                    "Alle i Blank kan dra på en større fagutviklingsaktivitet i året, slik som en konferanse, et lengre kurs eller seminar. Du velger selv hva du vil gjøre og trenger egentlig ikke å avklare med andre enn kunden og teamet ditt.  Aktiviteter registreres i ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/spreadsheets/d/1LfzXYBYMoFoHhNVZx14R8kRZzIu3fvU-RV8iKe6etT8",
                      children: ["fagutviklingsoversikten"],
                    },
                    " med litt info om hva det er, varighet og kostnad.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har ingen absolutt kostnadsramme, og det utvises skjønn om man ønsker å delta på mer. Hovedføringen er at fagaktivitetene dine skal gagne Blank og man gjør en vurdering på evt hyppighet og totalkostnad.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du kan bytte aktivitetsdagene vanligvis brukt til konferanser med egenlæringsdager dersom man mener man får bedre utbytte av det.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Frokosteminarer, meet-ups og lignende kommer utenom.",
                  ],
                },
              ],
            },
            {
              header: "Holde foredrag",
              slug: "holde-foredrag",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi vil gjerne at ansatte deler av det de kan og gjør, enten på konferanser eller interne og eksterne arrangementer. Har du en idé eller lyst til å holde foredrag, men vet ikke om hva kan du få hjelp på abstractworkshopen vår.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Hvis man holder foredrag på en konferanse, «teller» den ikke og er utenfor begrensningen på én årlig aktivitet.",
                  ],
                },
              ],
            },
          ],
          slug: "fagutvikling",
        },
        {
          header: "Lønn og betingelser",
          sections: [
            {
              header: "Lønn",
              slug: "lonn",
              text: [
                {
                  tag: "p",
                  children: [
                    "Lønn utbetales siste arbeidsdag hver måned. En gang i året gjøres en lønnsvurdering, og eventuelle justeringer har effekt fra 1. januar. Oppdatert lønnsliste over alle ansatte finner du i Drive. Lønnen i Blank bestemmes av en utjevnet kurve basert på ",
                    {
                      tag: "a",
                      href: "https://www.tekna.no/lonn-og-arbeidsvilkar/lonnsstatistikk/",
                      children: ["Teknas lønnsstatistikk"],
                    },
                    '. Vi baserer oss på øvre kvartil, og ser på både den bransjeuavhengige statistikken og på statistikken for "Data og IT".',
                  ],
                },
              ],
            },
            {
              header: "Feriepenger",
              slug: "feriepenger",
              text: [
                {
                  tag: "p",
                  children: [
                    "Feriepenger utbetales på junilønnen – samtidig som man trekkes for ferie.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Det skaper ofte litt forvirring, så er en kort forklaring av hvordan det funker:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Feriepenger for en full ferie tilsvarer 30/26 av en månedslønn. 30 = 5 uker ferie, 26 = en full månedslønn (26 virkedager). Fem uker ferie = trekk på 1 månedslønn + 4/26 deler av en månedslønn. ",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "For de som ikke har feriepenger fra i fjor, betyr det at det blir trukket en hel månedslønn pluss litt ekstra av lønnen for juli (4/26-deler).",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Du kan beregne junilønnen din slik:"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Månedslønn ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["minus"],
                    },
                    " Månedslønn*30/26 = Ferietrekk",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Opptjente feriepenger ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["minus"],
                    },
                    " Ferietrekk = Utbetalt i juni",
                  ],
                },
              ],
            },
            {
              header: "Halv skatt i november",
              slug: "halv-skatt",
              text: [
                {
                  tag: "p",
                  children: ["På novemberlønnen trekkes man bare halv skatt."],
                },
              ],
            },
            {
              header: "Overtidsbetaling",
              slug: "overtidsbetaling",
              text: [
                {
                  tag: "p",
                  children: [
                    "Det betales 40 % overtidsgodtgjørelse i tillegg til ordinær timelønn for avtalt overtidsarbeid. Ordinær timelønn beregnes ved å dele brutto alminnelig årslønn på 1950 timer.   ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Info om hva overtid er finner du ",
                    {
                      tag: "a",
                      href: "https://about.blank.no/#arbeidstid",
                      children: ["her"],
                    },
                    ".",
                  ],
                },
              ],
            },
            {
              header: "Medeierskap",
              slug: "medeierskap",
              text: [
                {
                  tag: "p",
                  children: [
                    "Når du starter i Blank får du 100 aksjer i selskapet og blir dermed medeier. I tillegg får alle tilbud om å kjøpe flere aksjer om de vil. Man må ikke kjøpe aksjer for å jobbe i Blank, men alle skal ha mulighet til det. For å skape god balanse i eierskapet får ansatte som eier mer enn 10 % av selskapet ikke tilbud om å kjøpe flere aksjer.",
                  ],
                },
                {
                  tag: "p",
                  children: ["Fordeler med ansatteierskap:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Du får være med på eie din egen arbeidsplass.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Du får økt innflytelse. Blant annet får du en stemme per aksje på Blanks generalforsamling.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Du får ta en større del av verdiveksten i selskapet gjennom utbytte og prisstigning på aksjene.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Mye tyder på at ansatteierskap fører til økt trivsel, produktivt og lønnsomhet (",
                    {
                      tag: "a",
                      href: "https://agendamagasin.no/kommentarer/5-grunner-flere-bor-eie-egen-arbeidsplass/",
                      children: ["1"],
                    },
                    ", ",
                    {
                      tag: "a",
                      href: "https://wol.iza.org/articles/does-employee-ownership-improve-performance",
                      children: ["2"],
                    },
                    ")",
                  ],
                },
              ],
            },
            {
              header: "Kjøpe aksjer",
              slug: "kjope-aksjer",
              text: [
                {
                  tag: "p",
                  children: [
                    "Hvert halvår har du som ansatt muligheter for å kjøpe aksjer i Blank. Dersom selskapet ikke har nok aksjer til å dekke etterspørselen vil tilgjengelige aksjer fordeles likt på interesserte ansatte.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Slik foregår det:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Alle ansatte i Blank som eier mindre enn 2,0% får tilbud om å kjøpe seg opp til dette nivået.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Aksjene prises løpende til en konservativ markedspris basert på antall ansatte.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Ansatte kan kjøpe aksjer kontant eller gjennom et rentefritt lån på 3/5 G (Grunnbeløpet i folketrygden). Lånet betales tilbake gjennom lønnstrekk over 12 måneder.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "I ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/spreadsheets/d/1FzH2t7B8lRx5sPLa7Ae5bSfncpxI4j0fqGmNc-w0zUw/edit?usp=sharing",
                      children: ["aksjeeierboka"],
                    },
                    " finner oversikt over blant annet aksjonærer og aksjefordeling.",
                  ],
                },
              ],
            },
            {
              header: "Pensjon",
              slug: "pensjon",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank sparer 5,5% av lønn mellom 0G og 12G i innskuddspensjon. Logg inn på ",
                    {
                      tag: "a",
                      href: "http://www.gjensidige.no/",
                      children: ["gjensidige.no"],
                    },
                    " med BankID dersom du ønsker å justere risikoprofilen for din pensjonssparing.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Innskuddspensjonen din havner på en Egen pensjonskonto (EPK) og du kan selv velge en annen forvalter for EPKen din enn Gjensidige om du ønsker det. Du kan også samle innskuddspensjon fra tidligere arbeidsgivere (Pensjonskapitalbevis) inn på din EPK.",
                  ],
                },
              ],
            },
            {
              header: "Forsikringer",
              slug: "forsikringer",
              text: [
                {
                  tag: "p",
                  children: [
                    "Her finner du en oversikt over forsikringene vi har. Informasjon om hvordan man benytter de forskjellige forsikringene ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1p2FoxN2ZB6yZblH87y4mz1KM_uBvditi5hTvZ2oZG1A/edit",
                      children: ["finner du her"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Reiseforsikring"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank dekker reiseforsikring hos Gouda for deg, samboer og barn. Reiseforsikringen gjelder samboeren også når du ikke reiser med hen, da vi betaler for dekning av hele familien. Forsikringen gjelder reiser i hele verden inntil 45 dager, også fritidsreiser. Hva som dekkes av forsikringen og hva ikke ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1p2FoxN2ZB6yZblH87y4mz1KM_uBvditi5hTvZ2oZG1A/edit",
                      children: ["finner du her"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Mobilforsikring"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har en egen Reiendomsforsikring som dekker skader på mobil utover den vanlige reiseforsikringen. Max sum 10 000 kr, egenandelen er 1000 kr.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Behandlingsforsikring"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle ansatte har tilgang til ubegrenset medisinsk rådgivning over telefon. I tillegg dekkes, for tilfeller som det offentlige helsevesen ikke dekker eller har lang ventetid konsultasjon, operasjon, fysioterapi, rehabilitering, reise og opphold, psykologisk førstehjelp og psykolog.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Gjennom forsikringen kan du også bruke legeappen Eyr til å ta legetimer gratis på mobilen. Last ned og legg inn forsikringsnummeret vårt, så slipper du å betale for konsultasjonene.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Yrkesskade- og yrkessykdomsforsikring"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Gir en engangsutbetaling i de tilfeller man pådrar seg en skade eller sykdom gjennom jobb eller reise til og fra arbeid som gjør at man ikke kan jobbe fullt eller noe i det hele tatt.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Uførepensjon"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Denne forsikringen sikrer deg en månedlig utbetaling frem til du blir pensjonist og gir deg 69% av fastlønn opp til 12G minus uførepensjon fra folketrygden. I tillegg kommer 10% av 1G som en ekstra utbetaling på toppen - uavhengig av lønnsnivå.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Innskuddsfritak"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Dersom du blir minst 20% ufør, dekker denne forsikringen innbetalinger til din pensjonskonto frem til du blir 67år, utfra din lønn på det tidspunktet du ble ufør.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Forsikringer du IKKE har"],
                    },
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Livsforsikring - behovet for livsforsikring varierer veldig etter livssituasjon og det er derfor ikke noe alle våre ansatte har bruk for.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Ulykkesforsikring"],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "Internett",
              slug: "internett",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank dekker internett hjemme hos deg med en øvre grense på 750 kroner inkludert mva. i måneden.",
                  ],
                },
              ],
            },
            {
              header: "Mobil",
              slug: "mobil",
              text: [
                {
                  tag: "p",
                  children: [
                    "Abonnement for mobiltelefoni dekkes av selskapet. Dette kan brukes fritt innenfor EU/EØS, med unntak av innholdstjenester dvs. kjøp av varer og tjenester via abonnementet.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank dekker kjøp av mobil (se arbeidsverktøy i avsnittet under) og har mobilforskring som dekker skader (se forsikringer under Lønn og betingelser).",
                  ],
                },
              ],
            },
            {
              header: "Arbeidsverktøy",
              slug: "arbeidsverktoy",
              text: [
                {
                  tag: "p",
                  children: [
                    "Hva enn av utstyr eller programvare du trenger for å gjøre jobben din står du fritt til å kjøpe inn. Behovet stoler vi på at du vurderer bedre enn ledelsen. Når du starter fikser du det du trenger for å komme i gang. Vi har avtale hos bl.a. hos Komplett, brukernavn og passord finner du i 1password.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Handler du utstyr eller programvare til over 500 kr legger du det inn i ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/spreadsheets/d/1-CSM95rUG8hX7NpfgoadOCD2UNetRxyE-iI8viDjLPA/edit?usp=sharing",
                      children: ["utstyrslista"],
                    },
                    " i tillegg til å utleggsføre i Tripletex.",
                  ],
                },
              ],
            },
            {
              header: "Utstyrslotteri",
              slug: "utstyrslotteri",
              text: [
                {
                  tag: "p",
                  children: [
                    "Utstyr som leveres tilbake til Blank loddes ut til interesserte og selges til den heldige vinner. Er utstyret over 3 år betaler man 500 kroner for dette.",
                  ],
                },
              ],
            },
            {
              header: "Fagbøker",
              slug: "fagboker",
              text: [
                {
                  tag: "p",
                  children: [
                    "Både papirbøker og elektroniske bøker kan kjøpes inn fritt. Vi har endel bøker på loftet allerede, hør på Slack eller sjekk i bokhylla først om det er noe du har lyst til å lese.",
                  ],
                },
              ],
            },
            {
              header: "Databriller",
              slug: "databriller",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank dekker synsundersøkelse og standard databriller hvis du trenger det.",
                  ],
                },
              ],
            },
            {
              header: "Treningsutstyr",
              slug: "treningsutstyr",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank dekker inntil 1000 kr i året til trening, det gjelder kjøp av utstyr, klær, kurs, abonnement, medlemsskap, lisens o.l. I tillegg sponser ",
                    {
                      tag: "a",
                      href: "https://blank.no/handboka#bedriftsidrettslag",
                      children: ["Blanks Bedriftidrettslag"],
                    },
                    " masse forskjellige aktiviteter dersom du er medlem og deltar med noen andre fra Blank.",
                  ],
                },
              ],
            },
            {
              header: "Bysykkel",
              slug: "bysykkel",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank sponser bysykkelabonnement for alle ansatte. Hør med Knut for å få kode.",
                  ],
                },
              ],
            },
            {
              header: "Ansattjubileum",
              slug: "ansattjubileum",
              text: [
                {
                  tag: "p",
                  children: [
                    "For hvert år du har vært ansatt i Blank får du en gave!",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "1 år 400,- kinokveld ",
                    {
                      tag: "br",
                    },
                    "\n2 år 1000,- kulturell opplevelse ",
                    {
                      tag: "br",
                    },
                    "\n3 år 2000,- mat i fjeset ",
                    {
                      tag: "br",
                    },
                    "\n4 år 500,- nørding i bokhandel ",
                    {
                      tag: "br",
                    },
                    "\n5 år 5000,- en kveld i tretoppene ",
                    {
                      tag: "br",
                    },
                    "\n6 år 1200,- ta smaksløkene på trim ",
                    {
                      tag: "br",
                    },
                    "\n7 år 2500,- gjør en forskjell",
                  ],
                },
              ],
            },
            {
              header: "Innkjøp og utlegg",
              slug: "utlegg",
              text: [
                {
                  tag: "p",
                  children: [
                    "Du står fritt til å gjøre innkjøp til Blank uten noen videre godkjenning. Som hovedregel gjelder det å bruke Blanks penger slik du ville brukt dine egne.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Utlegg utgiftsføres i ",
                    {
                      tag: "a",
                      href: "https://tripletex.no/",
                      children: ["Tripletex"],
                    },
                    ". Slik gjør du det:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Velg ",
                            {
                              tag: "span",
                              styles: ["italic"],
                              children: ["Reiser og utlegg"],
                            },
                            " og laste opp kvittering. Bruker du appen kan du også trykke på ",
                            {
                              tag: "span",
                              styles: ["italic"],
                              children: ["Utlegg"],
                            },
                            " og ta bilde av kvitteringen.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Velg relevant kategori og skriv kort hva utlegget gjelder og evt. hvem som var med, hvis du har betalt noe til et Blank-arrangement eller lignende.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Trykk ",
                            {
                              tag: "span",
                              styles: ["italic"],
                              children: ["Lever"],
                            },
                            " når utlegget er klar for godkjenning.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Utlegg refunderes sammen med lønnsutbetaling siste arbeidsdag i måneden og ca. den 15. hver måned.",
                  ],
                },
              ],
            },
            {
              header: "Rekrutteringstips",
              slug: "rekrutteringstips",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi har ikke rekrutteringsbonus i Blank, men dersom man tipser om kandidater som ender opp med å bli ansatt spanderer Blank middag på tipseren, den nyansatte og tre andre fra Blank som en del av onboardingen.",
                  ],
                },
              ],
            },
            {
              header: "Bedriftsavtaler",
              slug: "bedriftsavtaler",
              text: [
                {
                  tag: "p",
                  children: [
                    "Oversikt over bedriftsavtaler vi har finnes ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1q3nvdwHGf_wZk-c-33mrxw5CaHQwDKnjr1YHYJXoBiM/edit?usp=sharing",
                      children: ["her"],
                    },
                    ".",
                  ],
                },
              ],
            },
          ],
          slug: "betingelser",
        },
        {
          header: "Arbeidstid og fravær",
          sections: [
            {
              header: "Fleksibel arbeidstid",
              slug: "fleksibel-arbeidstid",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vanlig arbeidstid i Blank er 7,5 t dagen og 37,5 t i uka. Vi har ingen kjernetid og du velger i stor grad selv når og hvor du ønsker å jobbe, men du tilpasser deg kundens rutiner.",
                  ],
                },
              ],
            },
            {
              header: "Avspasering",
              slug: "avspasering",
              text: [
                {
                  tag: "p",
                  children: [
                    "Det er alltid OK å være mellom 37,5 timer i pluss eller minus på “avspaseringskontoen”. Dersom du går utenfor dette må du ta ut overtidsbetaling (dersom du har overtidsberettigede timer), avspasere eller jobbe inn/bruke ferie for å komme ajour.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Skal du ta ut avspasering er det greit å avklare med kunde. Du timefører ikke avspasering.",
                  ],
                },
              ],
            },
            {
              header: "Overtid",
              slug: "overtid",
              text: [
                {
                  tag: "p",
                  children: [
                    "Det er ingen forventning at du skal jobbe overtid, men om du selv vil kan du jobbe ekstra på et prosjekt. Du trenger bare passe på at det er ok for kunden (de betaler samme timepris uansett), eller for ansvarlige for internprosjektet om du jobber med det. Ved frivillig overtidsarbeid kan du velge mellom å få utbetalt ekstra lønn med overtidsgodtgjørelse eller avspasere like mange timer som du har jobbet ekstra. Hvis skulle bli pålagt eller bedt om å jobbe overtid, f.eks. hvis det trengs en liten ekstra innsats i en periode, kan du få timene utbetalt med overtidsgodtgjørelse eller avspasere 140 %. Hør med Tina hvordan du gjør det i praksis.",
                  ],
                },
              ],
            },
            {
              header: "Interntid",
              slug: "interntid",
              text: [
                {
                  tag: "p",
                  children: [
                    "Man skal som hovedregel kun føre timer på interne aktivteter dersom det er avklart. Følgende aktiviteter trenger ingen avklaring:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Innedag (7,5t)"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Konferanse/kurs og reise i den forbindelse (7,5t)",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Intervjuer og forberedelser"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Faginnlegg og forberedelser"],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "Ferie",
              slug: "ferie",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi har 5 ukers ferie (25 dager) og i tillegg fri fra og med julaften til og med nyttårsaften. Du har rett til å ta ut full ferie selvom du ikke har jobbet deg opp feriepenger fra året før, f.eks. hvis du er nyansatt. Info om hvordan ferielønnen beregnes finner du ",
                    {
                      tag: "a",
                      href: "https://blank.no/handboka#feriepenger",
                      children: ["her"],
                    },
                    ". Feriedagene dine avklares med team/kunde og deretter legges inn i ",
                    {
                      tag: "a",
                      href: "https://inni.blank.no/calendar",
                      children: ["fraværskalenderen"],
                    },
                    ". Når man er på ferie fører man 7,5 timer per fulle arbeidsdag eller de timene du tar ut ferie. Har du feriedager til gode, kan opp til 10 dager overføres til påfølgende år.",
                  ],
                },
              ],
            },
            {
              header: "Redusert stilling",
              slug: "redusert-stilling",
              text: [
                {
                  tag: "p",
                  children: [
                    "Ønsker du en periode å bruke mindre tid på jobb, er det mulig å redusere stillingsprosenten din eller ta midlertidig permisjon. Det kan du avtale med personallederen din.",
                  ],
                },
              ],
            },
            {
              header: "Permisjon og fravær",
              slug: "permisjon",
              text: [
                {
                  tag: "p",
                  children: [
                    "Husk å informere team/kunde om fravær og legg planlagt fravær inn i ",
                    {
                      tag: "a",
                      href: "https://inni.blank.no/calendar",
                      children: ["fraværskalenderen"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Fødsels-, svangerskaps- og barselpermisjon"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Selskapet dekker differansen mellom kompensasjon fra det offentlige, og fast lønn i selskapet.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Foreldrepermisjon påvirker ikke erfaringsbygging for lønn.",
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Ammefri"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Om du ammer får du opptil 1 time betalt ammefri per dag inntil barnet er 1 år.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Det er ingen øvre grense for ubetalt ammefri, har du behov for mer tid utover 1 time og/eller om barnet er over 1 år er det helt greit, bare gi beskjed til lederen din.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Repetisjonsøvelser"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Må du på repetisjonsøvelse dekker Blank differansen mellom det du får fra det offentlige, og fast lønn i selskapet.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Tilvenning i barnehage og første skoledag"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Når barnet ditt starter i barnehage eller på skole kan du ta tid for å hjelpe de på plass. Vanligvis brukes det 1 til 3 dager, men det er også mulig å bruke mer tid ved behov. Det oppfordres til å dele tilvenningstid med partner og bruke halve dager om det er mulig.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du kan selvsagt bruke tilvenningsdagene også om barnet bytter barnehage eller skole. Timene føres på Internt - Tilvenning barnehage/skole.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Dødsfall og begravelse"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Velferdspermisjon i forbindelse med dødsfall og begravelse kan føres på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Permisjon med lønn"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Flyttedag"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du kan bruke 1 lønnet dag til flytting, det føres på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Permisjon med lønn"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Legetimer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Legetimer, tannlegetimer og lignende kan føres på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Permisjon med lønn"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Sykt barn og omsorgsdager"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Alt som er definert av NAV som"],
                    },
                    " ",
                    {
                      tag: "a",
                      href: "https://www.nav.no/omsorgspenger#nar-kan-du-bruke-av-omsorgsdagene",
                      children: ["omsorgsdager"],
                    },
                    ", samt rutinekontroller på helsestasjon er lønnet fravær. Det føres på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Sykt barn"],
                    },
                    ". Du kan beregne hvor mange omsorgsdager du har rett til ",
                    {
                      tag: "a",
                      href: "https://www.nav.no/omsorgspenger/kalkulator-antall-omsorgsdager",
                      children: ["her"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Sykdom og egenmelding"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Du har 12 egenmeldingsdager, som kan benyttes enkeltvis eller sammenhengende. Disse dagene trenger man ikke legeerklæring for. Egenmelding fører du på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Sykdom - egenmelding."],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Sykdom og sykemelding"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Om du har brukt opp egenmeldingsdagene, må du ha sykemelding fra lege. Tiden du er syk med sykemelding føres på ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Internt - Sykdom - sykemelding."],
                    },
                  ],
                },
              ],
            },
          ],
          slug: "fravaer",
        },
        {
          header: "Organisering",
          sections: [
            {
              header: "Administrasjon",
              slug: "administrasjon",
              text: [
                {
                  tag: "p",
                  children: ["Administrasjonen består av:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Daglig leder - Jahn Arne Johnsen"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Salgssjef - Knut Backer"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Leder for Teknologi - Magne Davidsen "],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Leder for Design - Jon Bernholdt Olsen"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Kontorsjef - Tina Pande "],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Fagsjef Teknologi - Ole Jacob Syrdahl "],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Fagsjef Design - Lee Frost"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "h3",
                  children: [],
                },
              ],
            },
            {
              header: "Styret og ansattrepresentanter",
              slug: "styret-og-ansattrepresentanter",
              text: [
                {
                  tag: "p",
                  children: ["Styret i Blank består pt. av:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Magne Davidsen - Styreleder - Rep: Majoritetsaksjonærene",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Jon Bernholdt Olsen - Styrets nestleder - Rep: Majoritetsaksjonærene",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Knut Backer - Styremedlem - Rep: Majoritetsaksjonærene",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Clara Patek - Styremedlem - Rep: Øvrige aksjonærer",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Ingrid Moen - Styremedlem - Ansattrepresentant",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Une Nordli - Styremedlem - Ansattrepresentant",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Lars Skjelbek - Varamedlem for Clara Patek (øvrige aksjonærer)",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Thea Basthus Nilsen - Varamedlem for Une Nordli (ansatte)",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Lars-Ive Gjærder - Varamedlem for Ingrid Moen (ansatte)",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Representanter for øvrige aksjonærer og de ansatte velges for to år av gangen.",
                  ],
                },
              ],
            },
            {
              header: "Åremålsroller",
              slug: "aaremaalsroller",
              text: [
                {
                  tag: "p",
                  children: [
                    "Noen viktige ansvarsområder i Blank er fordelt på ulike åremålsroller. Det er for å sørge for at de blir godt ivaretatt og for å gi de som ønsker det mer ansvar og utviklingsmuligheter.   ",
                  ],
                },
                {
                  tag: "p",
                  children: ["De ulike rollene og ansvarlige for 2024 er:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Oppstartsansvarlig - Martin Bøckman"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Rekrutteringsansvarlig design - Lars-Ive Gjærder",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Rekrutteringsansvarlig teknologi - Simen Grini",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Visuell identitet & merkevare - Bendik Schrøder",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Leder for Blank Bedriftsidrettslag - Adam Gaidi",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Sosialt- og arrangementsansvarlig - Thomas A. Ramirez",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Man får 50 000,- i året for ansvaret med å ha en åremålsrolle, i tillegg kan man føre overtid for arbeid ut over normal arbeidstid. Du får en egen timeføringskonto som du skal bruke til arbeidet.",
                  ],
                },
              ],
            },
            {
              header: "Oppdragsansvarlig",
              slug: "oppdragsansvarlig",
              text: [
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Støtte salg i kundeutvikling – og innhente tilbakemeldinger fra kunden til Blank",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Følge opp og støtte Blank-konsulentene som er hos kunden",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Som oppdragsansvarlig har man følgende oppgaver:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Regelmessig kontakt med salgssjef angående status hos kunde",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Halvårlige møter med alle oppdragsansvarlige for erfaringsutveksling",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Kvartalsvise prosjektsamtaler med alle Blank-konsulenter hos kunden",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Hvem som er oppdragsansvarlig for en kunde kan man se i ",
                    {
                      tag: "a",
                      href: "https://inni.blank.no/projects",
                      children: ["prosjektapplikasjonen"],
                    },
                  ],
                },
              ],
            },
            {
              header: "Personalleder",
              slug: "personalleder",
              text: [
                {
                  tag: "p",
                  children: [
                    "Alle i Blank har en personalleder. Man velger sin egen personalleder blant personene i administrasjonen eller fagledelsen i ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/spreadsheets/d/1STB_QgMnUv9UxZKmrWJjAsL6zOgZtbqu6Y-T4ZXh1as/edit#gid=0",
                      children: ["dette dokumentet"],
                    },
                    ". Husk å si i fra til vedkommende. Man kan når som helst bytte.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Frem til du evt. velger en annen personalleder er det «Leder for Teknologi» som har ansvaret for teknologer, og «Leder for Design» som har ansvaret for designere.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Personalleder følger opp din:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Bemanning (engasjement og prosjekt)"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Lønn"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Faglige utvikling"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Generelle trivsel"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle får et tilbud om fysisk samtale minst to ganger i året.",
                  ],
                },
              ],
            },
            {
              header: "Fagleder",
              slug: "fagleder",
              text: [
                {
                  tag: "p",
                  children: [
                    "Fagleders hovedansvar er å tilrettelegge for faglig og personlig utvikling for de ansatte innen sitt fagområde. Faglederne er en del av administrasjonen og svarer til leder for design eller teknologi.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Faglederen din har i oppgave å:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Sørge for at du får den faglige veiledningen og oppfølgingen du har behov for.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Legge til rette for faglig opplegg som kurs og lignende du kan delta på om du vil.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Sørge for at du har gode rammer for å kunne fokusere på egen fagutvikling.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle får tilbud om en fagutviklingssamtale minst to ganger i året. Faglederen tar initiativ til samtalen, men du kan selv velge hvordan den skal gjennomføres og hvem du ønsker å prate med.",
                  ],
                },
              ],
            },
            {
              slug: "amu",
              text: [
                {
                  tag: "p",
                  children: [
                    "AMU skal, sammen med arbeidsgiver legge til rette for at alle kan bidra til et godt felles arbeidsmiljø, som i Blank er å etterleve prinsippene tillit, åpenhet og fellesskap",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Representanter fra arbeidsgivers side:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Jahn Arne Johnsen"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Knut Backer"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Tina Pande - Varamedlem"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Representanter fra arbeidstakers side:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Ingrid Moen - Hovedverneombud"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Une Nordli"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Lars-Ive Gjærder - Varamedlem"],
                        },
                      ],
                    },
                  ],
                },
              ],
              header: "Arbeidsmiljøutvalg (AMU)",
            },
          ],
          slug: "organisering",
        },
        {
          header: "Loftet",
          sections: [
            {
              header: "Bruk av loftet",
              slug: "bruk-av-loftet",
              text: [
                {
                  tag: "p",
                  children: [
                    "I Blank jobber vi tett med kundene våre og sitter vanligvis sammen med de, men har vi mulighet sitter vi gjerne på kontoret vårt - loftet. Vi har jobbet mye for å gjøre loftet til et behagelig sted hvor du skal ha lyst å være. Her har vi alt vi trenger for å lage bra greier, jobbe sammen eller alene og ha faglige arrangementer og fester. På kjøkkenet er det alltid god kaffe, drikke og snacks.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Bruk av loftet er ganske selvforklarende, men om du lurer på noe kan du ta en titt på ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1KfxwuWTmriCPuk_uhgIs_n3etA-ab-_uESHwuTZdD_k/edit#heading=h.iv37hw93zicf",
                      children: ["En guide til loftet"],
                    },
                    ".",
                  ],
                },
              ],
            },
            {
              header: "Tøfler",
              slug: "tofler",
              text: [
                {
                  tag: "p",
                  children: [
                    "For å holde det rent og trivelig på loftet har vi en innesko/tøffel/sokkelesten-policy. Alle kan kjøpe seg et par tøfler til å ha på Loftet for inntil 600,- og utgiftsføre. Vi har en liten kasse med lånetøfler til gjester og de som har glemt.",
                  ],
                },
              ],
            },
            {
              header: "Ha med gjester",
              slug: "ha-med-gjester",
              text: [
                {
                  tag: "p",
                  children: [
                    "Man står fritt til å bruke møterommene og loftet til workshops og samarbeid med kunder. Venner og gjester av ansatte er også velkommen til å låne en pult for en dag eller to såfremt vi har ledig plass, man må bare skrive under taushetserklæring som lastes opp på drive.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Gjester kan benytte besokhosblank-nettverket, og Blank-ansatte kan booke møterom og området de trenger via kalenderen.",
                  ],
                },
              ],
            },
            {
              header: "Utenfor arbeidstid",
              slug: "utenfor-arbeidstid",
              text: [
                {
                  tag: "p",
                  children: [
                    "Det er bare hyggelig dersom ansatte ønsker å bruke kontoret utenfor normal arbeidstid, enten som arbeidsplass eller til sosialisering. Den viktigste regelen er at man etterlater kontoret rent og ryddig.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Om du vil bruke kontoret til et eget arrangement gjelder følgende:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Spør på Slack (#loftet) om det er OK."],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Lag en hendelse i Google Calendar og legg til Loftet.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Skaff egen mat og drikke. Benytt helst ikke varer kjøpt inn til Blank, ihvertfall ikke uten å erstatte de.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Vurder om det er nødvendig å avtale ekstra vask og renhold før kontoret skal brukes til jobb.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle ansatte har lik rett til å bruke kontoret, og «førstemann til mølla» gjelder dersom man ønsker å bruke hele kontoret alene.",
                  ],
                },
              ],
            },
            {
              header: "Mat og drikke",
              slug: "mat-og-drikke",
              text: [
                {
                  tag: "p",
                  children: [
                    "Om du benytter loftet sosialt sammen med kolleger, f.eks. filmkveld eller fredagspils, kan dere forsyne dere alt av mat og drikke som finnes på loftet, eller kjøpe inn og utgiftsføre.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Det er også helt greit å ta med venner i uformelle sammenhenger. Spiser og drikker dere da for mer enn ca 500 kr bør det erstattes. Du kan enten kjøpe inn tilsvarende du har brukt eller høre om innkjøpsansvarlig kan bistå og få det trukket av lønna. Gjør det så raskt som mulig, så vi ikke går tom.",
                  ],
                },
              ],
            },
            {
              header: "Vask",
              slug: "vask",
              text: [
                {
                  tag: "p",
                  children: [
                    "Kontoret vaskes på kveldstid to ganger i uken, se tidspunkt i loft-kalenderen. Ta kontakt med Tina om du trenger å flytte eller bestille ekstra vask.",
                  ],
                },
              ],
            },
            {
              header: "Utstyr på loftet",
              slug: "utstyr",
              text: [
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Printer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "I skapet ved siden av store møterom står det en printer/kopimaskin/scanner som printer i A4. Den funker når du er koblet til hjemmehosblank-nettverket.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["3D-printer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har en Prusa 3D-printer som det selvfølgelig er fritt frem for alle å bruke. Det finnes en liten oppstartsguide ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1qxc_b4R94w1YC0-eBi2tNAUb1rGHqKqYe2wqes5c4F4",
                      children: ["her"],
                    },
                    ".",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["AV-utstyr"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Når man er koblet til det trådløse nettet kan man spille til høyttalerne med Spotify Connect. For å stille volumet til høyttalerne bruker man appen ",
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Spark"],
                    },
                    " fra Devialet.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["PA-anlegg"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har en DJ-mixer som er koblet rett til PA-anlegget.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["VR"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har VR-briller, og en egen PC med en rekke spill. Passordet til PCen finner du i 1Password. Dersom du har problemer med å komme i gang, spør på Slack.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Tappetårn"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "I ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1KfxwuWTmriCPuk_uhgIs_n3etA-ab-_uESHwuTZdD_k/edit#heading=h.sy8dcmnsvotr",
                      children: ["En guide til loftet"],
                    },
                    " finner du også en guide til bruk av tappetårnet - hvordan du kobler fra og til fat og rengjør. Loggfør renhold og andre praktiske hendelser med tappetårnet på Google Drive ",
                    {
                      tag: "a",
                      href: "https://drive.google.com/open?id=12dMDQAyuNo45Sak9J4j5F3i7CQ672nbq9CNFzQ4Zzmw",
                      children: ["her"],
                    },
                    ".",
                  ],
                },
              ],
            },
          ],
          slug: "loftet",
        },
        {
          header: "Sosialt",
          sections: [
            {
              header: "Sosialt i Blank",
              slug: "sosialt-i-blank",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi liker å gjøre ting sammen og Blank arrangerer flere mer eller mindre faste arrangementer. Vi støtter gjerne sosiale aktiviteter, det er bare å starte ting så lenge det er åpent for alle. Når du joiner Blank-slacken blir du invitert til alle kanalene for sosiale aktiviteter og velger selv hva du vil være med på. Under finner du en oversikt over noen av aktivitetene vi har.",
                  ],
                },
              ],
            },
            {
              header: "Fester og sånt",
              slug: "fest",
              text: [
                {
                  tag: "p",
                  children: [
                    'I løpet av året har vi flere fester og arrangementer. Vi drar blant annet på Øyafestivalen sammen, feirer julebord, julelunsj og juletrefest (for Blank-barn), vi har lønningspils, og sommerfest. Vi liker å få besøk og inviterer venner og bransjefolk til f.eks. studentfest, bursdagfest og vors. Har noen en god idé til en fest eller noe annet gøy heier vi på og støtter det, "Is på tusen vis"-temakvelden eller Juleølsmakingen er noen eksempler.',
                  ],
                },
              ],
            },
            {
              header: "Pizzabot",
              slug: "pizzabot",
              text: [
                {
                  tag: "p",
                  children: [
                    "Pizzaboten inviterer folk på pizza, og når fem stk har svart ja til pizza på satt dato, postes det i #pizza. Så er det bare å glede seg til pizza.",
                  ],
                },
              ],
            },
            {
              header: "Middagsklubb",
              slug: "middagsklubb",
              text: [
                {
                  tag: "p",
                  children: [
                    "Middagsklubben er en ganske lavterskel aktivitet hvor én person inviterer til middag hjemme hos seg, kommer opp med hva som skal lages den kvelden, og handler inn matvarer og drikke. Vi lager maten og spiser sammen. Blank dekker utgiftene.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Den som hoster kan enten sette en dato, eller ha en avstemning i #middagsklubben. Si fra hvor mange du har plass til, samme om det er to, seks eller 20 stk – så er det first come, first serve av de som har anledning til å være med den satte datoen.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Dersom man synes det er litt pes å stå for alt fra vertskap til innkjøp og å komme opp med meny, er det selvfølgelig fritt frem for å slå seg sammen med flere.",
                  ],
                },
              ],
            },
            {
              header: "FIFA-turnering",
              slug: "fifa-turnering",
              text: [
                {
                  tag: "p",
                  children: [
                    "FIFA-turnering arrangeres med ujevne mellomrom. Alle kan invitere med venner og kjente.",
                  ],
                },
              ],
            },
            {
              header: "Filmklubb",
              slug: "filmklubb",
              text: [
                {
                  tag: "p",
                  children: [
                    "Folk i Blank lager popcorn og ser på en kul film sammen på loftet. Se #filmklubb på Slack for å avtale når og hva som vises.",
                  ],
                },
              ],
            },
            {
              header: "Telttur",
              slug: "telttur",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vann og dann hender det at noen av oss tar seg en telt- og/eller hengekøyetur. Se #telttur for datoer.",
                  ],
                },
              ],
            },
            {
              header: "Skitur",
              slug: "skitur",
              text: [
                {
                  tag: "p",
                  children: [
                    "De siste to årene har vi leid hytte og dratt på skitur med en gjeng folk. Det er åpent både fordi som vil stå nedover, gå bortover, eller som bare vil spise mat og spille yatzy. Nye skiturer annonseres i #general.",
                  ],
                },
              ],
            },
            {
              header: "Vinklubben",
              slug: "vinklubben",
              text: [
                {
                  tag: "p",
                  children: [
                    "1 person hoster og bestemmer tema for vinkveld. Alle som er med tar med en flaske som passer til tema. Info i #vinklubben.",
                  ],
                },
              ],
            },
            {
              header: "Kunst- og håndverkskveld",
              slug: "kunst-og-haandverkskveld",
              text: [
                {
                  tag: "p",
                  children: [
                    "En kveld for de som syr, strikker, maler, spikker, tegner, bygger, fikser, trykker eller vil lære i Blank. Vi tar med prosjektene våre og henger sammen på loftet. Info i #kunst-og-håndverk.",
                  ],
                },
              ],
            },
          ],
          slug: "sosialt",
        },
        {
          header: "Bedriftsidrettslag",
          sections: [
            {
              header: "Bedriftsidrettslag",
              slug: "bedriftsidrettslag-2",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi har et bedriftsidrettslag som har som mål å fremme aktivitet, trening og trivsel. Vi arrangerer faste ukentlige aktiviteter, som squash og løpeturer, samt andre aktiviteter som avtales etter behov, for eksempel klatring, yoga og pilates. Tidligere har vi også deltatt på tenniskurs, prøvd skiskyting og hatt førstehjelpskurs.\n",
                    {
                      tag: "br",
                    },
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Hvis du har forslag til andre aktiviteter du ønsker å gjøre, er det bare å ta kontakt med lederen for bedriftsidrettslaget, så ser vi hva vi kan få til.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Årsavgiften er 100 kr, og den kan betales via Vipps til BLANK BEDRIFTSIDRETSSLAG (#558110).",
                  ],
                },
              ],
            },
            {
              header: "Løping",
              slug: "loping",
              text: [
                {
                  tag: "p",
                  children: [
                    "Flere av oss i Blank liker å løpe korte, rolige eller lange, raske turer. Uansett om du vil konkurrere mot Strava-botens lister i #random hver mandag eller slå din egen tid fra i fjor, er det alltid gøy å ha et mål å trene mot. Derfor melder vi oss hvert år på mosjonsløp som Sentrumsløpet, Holmenkollstafetten, Fornebuløpet, Nøklevann Rundt og Oslo Maraton. Gi beskjed hvis det er et løp du ønsker å delta på, så ordner vi med påmeldingskode og bankett. Hver mandag er det også en gruppe som løper en kort runde i sentrum før jobb, og de vil gjerne ha med flere på turen.",
                  ],
                },
              ],
            },
            {
              header: "Squash",
              slug: "squash",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank spiller squash på ",
                    {
                      tag: "a",
                      href: "http://www.sqf.no/sentrum-squash-fitness/",
                      children: ["Sentrum Squash & Fitness"],
                    },
                    " på onsdager 17–18. Utstyr kan leies på stedet, eller kanskje noen andre i Blank har utstyr til utlån. Følg med i kanalen #bil-squash for mer informasjon og for å melde deg på. Hvis du vil samle en gjeng fra jobben og spille på andre tidspunkter, er det mulig å booke bane som bedriftsbruker, innloggingsinformasjon finner du i 1password.",
                  ],
                },
              ],
            },
            {
              header: "Tennis og Padel",
              slug: "tennis-og-padel",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi har avtale med Oslo Tennisarena på Hasle, der vi kan booke både tennis- og padelbaner. Sjekk kanalene #bil-tennis eller #bil-padel for å finne noen å spille med. Bedriftsbruker finner du i 1password.",
                  ],
                },
              ],
            },
            {
              header: "Esport",
              slug: "esport",
              text: [
                {
                  tag: "p",
                  children: [
                    "Kanalen #bil-esport har en bot som hver andre uke sjekker om det er interesse for å booke et rom på Eldorado Gaming. Hvis det er interesse, booker vi rom, og deltakerne bestemmer selv hvilke spill de vil spille og hvordan de vil organisere det.",
                  ],
                },
              ],
            },
            {
              header: "Klatring",
              slug: "klatring",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank klatrer vanligvis på tirsdager klokken 07:00. Blank har avtale med Klatreverket. Vis ID i resepsjonen, så får du et personlig kort som du kan bruke når det er to eller flere fra Blank som er med og klatrer. Finn klatrepartnere på #bil-klatring, og husk at som med alle andre Blank-aktiviteter er terskelen ekstremt lav.",
                  ],
                },
              ],
            },
            {
              header: "Yoga og pilates",
              slug: "yoga",
              text: [
                {
                  tag: "p",
                  children: [
                    "I blant gjør vi yoga eller pilates sammen. Vi har en avtale med Kjernekraft Oslo som holder timer. Vanligvis avtaler vi hvilken time vi vil gå på i #bil-yoga-pilates. For å bli med oppretter man en personlig konto hos Kjernekraft og melder seg på timen selv. Informasjon om oppretting av konto og påmelding finnes pinnet i #bil-yoga-pilates. Her gjelder også regelen om at man må være minst 2 stykker.",
                  ],
                },
              ],
            },
            {
              header: "Stravaboten",
              slug: "stravaboten",
              text: [
                {
                  tag: "p",
                  children: [
                    "Hver mandag kl 8 sender Stravaboten en melding til #random i Slack med sist ukes treningstopplister. For å dukke opp i lista må du melde deg inn i tilhørende klubb på Strava:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://www.strava.com/clubs/blank",
                              children: ["Løping"],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://www.strava.com/clubs/blank-pedal",
                              children: ["Sykling"],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://www.strava.com/clubs/blanke-ski",
                              children: ["Ski"],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://www.strava.com/clubs/blankwalking",
                              children: ["Gåing"],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Hvis du ikke dukker opp i lista til tross for at du er medlem av den respektive klubben er nok årsaken at du har en ikke-offentlig profil. Da må Stravabotens medhjelper, ",
                    {
                      tag: "a",
                      href: "https://www.strava.com/athletes/37800142",
                      children: ["Speed Freak"],
                    },
                    ", følge deg på Strava. Si ifra til Lars Skjelbek, så fikser han det. Eventuelt logg inn på Strava med Speed Freak-kontoen og følg deg selv (brukernavn og passord ligger i Blanks 1password).",
                  ],
                },
              ],
            },
            {
              header: "Utstyr",
              slug: "utstyr",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank BIL har også diverse utstyr til utlån, blant annet for frisbeegolf, croquet, kubb, tennis, fotball, osv. Hvis det er behov for mer utstyr, kan vi kjøpe inn det.",
                  ],
                },
              ],
            },
          ],
          slug: "bedriftsidrettslag",
        },
        {
          header: "Bærekraft",
          sections: [
            {
              header: "Bærekraft i Blank",
              slug: "baerekraft-i-blank",
              text: [
                {
                  tag: "p",
                  children: [
                    "Blank ønsker å bidra til en bærekraftig utvikling innenfor:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Likestilling og mangfold"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Økonomi"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Miljø og klima"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi vet at vi bare er et lite norsk selskap, men ønsker å bidra hvor vi kan og være til inspirasjon. Vi er genuint opptatt av bærekraft og det er viktig for oss å være konkrete og ærlige på hvilke tiltak og ordninger vi har, og tankegangen bak disse.",
                  ],
                },
              ],
            },
            {
              header: "Likestilling og mangfold",
              slug: "likestilling",
              text: [
                {
                  tag: "p",
                  children: [
                    "Flere deler av Blanks grunnfilosofi og prosesser er ment for å minimere ulikheter basert på kjønn og bakgrunn. Vårt mål er å bygge et selskap der alle føler de er involvert og har lik mulighet for å bidra, skape og engasjere seg.   ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi følgende ordninger for å bl.a. å redusere ulikhet:",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Åpen lønn"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Åpen lønn og felles lønnsutvikling basert på erfaring skaper likhet og felles forventninger på tvers av kjønnene. Vi trekker ikke foreldrepermisjon fra erfaringsbyggingen i lønn.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Representasjon i rekruttering"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Kvinnelige utviklere og mannlige designere prioriteres inn når vi rekrutterer aktivt selv. Vi vil øke representasjon i ansettelsesprosessene, men prosessen er lik for alle og vi kvoterer ikke.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Investeringsmuligheter"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har like muligheter for alle og flere støtteordninger for at ansatte skal kunne investere i selskapet.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Kulturelt mangfold"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blanks største utfordring når det gjelder kulturelt mangfold er at vi har norsk som arbeidsspråk, og stiller krav om gode norskferdigheter. Dette gjør at mange dyktige utviklere og designere med bakgrunn fra andre land enn Norge ikke blir vurdert.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi ønsker å bedre dette ved å gi støtte til norskkurs til de som har et godt utgangspunkt, men ønsker å etablere språket enda bedre.",
                  ],
                },
              ],
            },
            {
              header: "Økonomi",
              slug: "okonomi",
              text: [
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Bærekraftig og trygg økonomi"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Selskapet drives økonomisk bærekraftig og trygge ansettelsesforhold.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Gode arbeidsforhold"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank er opptatt av gode arbeidsforhold for de ansatte, de aller fleste beslutninger tas med utgangspunkt i den ansatte. Vi ønsker at flest mulig som direkte påvirkes av en beslutning også deltar i prosessen.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Etikk i salgsprosesser"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Den største påvirkningsmuligheten Blank har som selskap ligger i arbeidet vi gjør for kundene våre. Fordi vår salgs- og bemanningsprosess er åpen er det mulig for alle ansatte å komme med innspill med tanke på etikk og bærekraft i kunder og oppdrag som vurderes.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Dersom prosessen holdes hemmelig etter spesielt ønske fra kunde eller ved sensitive prosjekter skal den etiske siden av oppdraget vurderes av minst en person i administrasjonen utover salgsansvarlig.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Medbestemmelsesrett"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Dine etiske vurderinger er gyldig grunn til å ikke ville jobbe for en kunde. Vi har diskusjoner på selskapsnivå i vurderingen av oppdrag, men er forsiktige med å lage generelle retningslinjer for hvilke kunder/bransjer vi skal jobbe for. Den enkeltes mulighet til å bestemme er viktig for oss og vi ønsker at disse vurderingene skal tilhøre de som på tidspunktet jobber i Blank.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Registrering av bærekraftsmål"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle prosjekter som opprettes i internsystemene våre kan tagges med relevante underkategorier fra FNs bærekraftsmål. Det er ikke et krav om at prosjektene vi gjør er knyttet til bærekraftsmål, men ved å tagge prosjektene har vi mulighet til å se effekten av arbeidet vi gjør.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Veldedighet"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank bidrar økonomisk til veldedighet hvert år, for å gi tilbake til andre deler av samfunnet som ikke har samme muligheter som oss. Eksempler på mottakere av slike gaver er: WWF, CARE, Kirkens Bymisjon, Nerdaid, Fattighuset, Ocean Cleanup, Flyktninghjelpen mv.",
                  ],
                },
              ],
            },
            {
              header: "Miljø og klima ",
              slug: "miljo",
              text: [
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Kontormiljø"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Som et konsulentselskap som stort sett leverer digitalt og har de fleste ansatte sittende ute hos kunde, har kontoret vårt liten påvirkning på ytre miljø. Det er for øvrig lagt opp til kildesortering, selskapet har ikke papirarkiv og det er ellers lite bruk av papir og utskrifter.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Unngå overforbruk"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank bruker som hovedregel ikke budsjetter eller rammer - hverken på selskapsnivå eller ansattnivå. Dette fordi det ofte kan føre til ekstra forbruk for å «bruke opp rammen» uten at det dekker et reelt behov. Vi ønsker å kjøpe utstyr når vi trenger det - og som varer lenge.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Begrenset utskifting av utstyr"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank har ikke regelmessig utskifting av utstyr, men utstyret vårt byttes først ut når det trengs. Brukt utstyr leveres tilbake til Blank og gjenbrukes, loddes ut til de ansatte eller doneres. Slik sikrer vi at gammelt og brukbart utstyr ikke kasseres unødvendig.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Bærekraftighet i arbeidsreiser"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Blank oppfordrer til å vurdere alternative reisemåter dersom tid- og avstand tillater det. Dette er opp til hver enkelt. Om man kan jobbe på reisen må man gjerne velge tregere reisemåter.  Alle ansatte oppfordres også til å klimakompensere for flyreiser.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Sykkeltransport"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Til reising i Oslo oppfordres de ansatte til bruk av sykkel og Blank kjøper hvert år abonnement på Oslos bysykkel-løsning til hver ansatt.  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Vegetariske alternativer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Det er alltid mulig å velge vegetar-varianter på arrangementene våre.",
                  ],
                },
              ],
            },
          ],
          slug: "baerekraft",
        },
        {
          header: "Varsling",
          sections: [
            {
              header: "Om varsling",
              slug: "om-varsling",
              text: [
                {
                  tag: "p",
                  children: [
                    "Varsling er at vi sier ifra om kritikkverdige forhold til noen som kan gjøre noe med det.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: [
                        "Med kritikkverdige forhold menes forhold som er i strid med",
                      ],
                    },
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Lover og regler (rettsregler)"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Skriftlige etiske retningslinjer"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Etiske normer som det er bred tilslutning til i samfunnet.",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Lovbrudd og straffbare forhold anses alltid som kritikkverdige forhold.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["italic"],
                      children: ["Eksempler på kritikkverdige forhold er"],
                    },
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Fare for liv eller helse"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Korrupsjon eller annen økonomisk kriminalitet, myndighetsmisbruk ",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Uforsvarlig arbeidsmiljø"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Brudd på personopplysningssikkerheten"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Vi har en fullstendig varslingsprosedyre med mer informasjon ",
                    {
                      tag: "a",
                      href: "https://docs.google.com/document/d/1XOSHjKzYs_eHSaKOFrvmsyYBUyfKcm3ikalcUA4Dvb8/edit",
                      children: ["her"],
                    },
                    " - den ble satt opp i AMU basert på et oppsett fra ",
                    {
                      tag: "a",
                      href: "https://www.arbeidstilsynet.no/varslingsrutinen/",
                      children: ["Arbeidstilsynet"],
                    },
                    ". ",
                  ],
                },
              ],
            },
            {
              header: "Varslingsplikt",
              slug: "varslingsplikt",
              text: [
                {
                  tag: "p",
                  children: [
                    "Noen ganger har vi plikt til å varsle. Det gjelder dersom vi blir:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Oppmerksomme på feil eller mangler som kan medføre fare for liv eller helse, og som ansatte ikke selv kan rette opp",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Kjent med at det skjer trakassering eller diskriminering på arbeidsplassen",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Skadet eller syke av arbeidet eller forholdene på arbeidsplassen",
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "Hvordan varsle",
              slug: "hvordan-varsle",
              text: [
                {
                  tag: "p",
                  children: [
                    "Vi ønsker først at du varsler til nærmeste leder (oppdragsansvarlig, personalleder, daglig leder).",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Dersom du vil ha støtte til å håndtere saken kan du kontakte verneombud eller noen andre i AMU. Varselet kan gis i det formatet den ansatte ønsker. For eksempel muntlig, over slack, e-post eller lignende.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Gjelder varselet øverste leder kan du varsle verneombud/AMU eller styreleder.",
                  ],
                },
              ],
            },
            {
              slug: "anonyme-varsler",
              text: [
                {
                  tag: "p",
                  children: [
                    "Hvis du ønsker å varsle anonymt kan du (inntil vi har et skjema på plass) printe ut varselet og legge det i skapet til den du ønsker å varsle til. ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Husk at det kan være vanskelig å løse noe uten mulighet til å prate med den som varsler. Hos Verneombud/AMU  kan du alltid få støtte hvis det er noe du syns er vanskelig å varsle om.",
                  ],
                },
              ],
              header: "Anonyme varsler",
            },
          ],
          slug: "varsling",
        },
        {
          header: "Nyttig å vite",
          sections: [
            {
              header: "Endre innhold",
              slug: "endre-innhold",
              text: [
                {
                  tag: "p",
                  children: [
                    "Dersom du ønsker å bidra ved å endre eller legge til innhold på blank.no kan du gjøre dette i ",
                    {
                      tag: "a",
                      href: "https://www.blank.no/api/val/authorize?redirect_to=https://www.blank.no/api/val/enable?redirect_to=https://blank.no/val",
                      children: ["Val"],
                    },
                    ". Du får tilgang til av Magne.",
                  ],
                },
              ],
            },
            {
              header: "Oversikt over internsystemer",
              slug: "internsystemer",
              text: [
                {
                  tag: "p",
                  children: [
                    "Du får tilgang på alle nødvendige internsystemer ved oppstart, hvis du mangler noe spør på Slack.",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://inni.blank.no",
                              children: ["inni.blank.no"],
                            },
                            " for timeføring, overtid, fraværskalender, ansattliste, KPI m.m.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://tripletex.no/execute/login",
                              children: ["Tripletex"],
                            },
                            " for å lage utlegg og finne lønnsslipper. ",
                            {
                              tag: "a",
                              href: "https://www.tripletex.no/tripletex-pa-mobil/",
                              children: ["Last ned appen"],
                            },
                            " for tilgang på mobil.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://slack.com/",
                              children: ["Slack"],
                            },
                            " for kommunikasjon.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://trello.com/w/ncx35",
                              children: ["Trello"],
                            },
                            " for program på innedagene og for å følge med på bemanning og salg, byråkratiet og årshjul.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Drive for lagring."],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://blank.cvpartner.com/",
                              children: ["CV Partner"],
                            },
                            " for å oppdatere CV.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://app.recruitee.com/#/dashboard/overview",
                              children: ["Recruitee"],
                            },
                            " for håndtering av rekruttering.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "1Password for håndtering av passord og felleskontoer.",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            {
                              tag: "a",
                              href: "https://dashboard.robinpowered.com/loftet/login",
                              children: ["Robin"],
                            },
                            " for å booke plass på loftet. ",
                            {
                              tag: "a",
                              href: "https://robinpowered.com/downloads",
                              children: ["Last ned appen"],
                            },
                            " for tilgang på mobil.",
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              header: "Jahn Arnes ordliste",
              slug: "ordliste",
              text: [
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Faktureringsgrad"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Faktureringsgrad (FG) benyttes både i forbindelse med forecasting for bemanning, og i forbindelse med rapportering. Faktureringsgrad beregnes på følgende måte:  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Faktureringsgrad = Fakturerbare timer / Tilgjengelige timer  ",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Tilgjengelige timer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Alle timer som er tilgjengelig for arbeid på selskapsnivå, det vil si timene det betales lønn for. Tilgjengelige timer i en periode beregnes på følgende måte:",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Tilgjengelige timer = Arbeidsdager i perioden * Ansatte i perioden * 7,5 - Fratrekk",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: ["Følgende trekkes fra:"],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Helligdager (faktiske og selskapsbestemte)",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Ferie"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: [
                            "Permisjon uten lønn (inkludert foreldrepermisjon)",
                          ],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Sykdomsfravær med sykemelding"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Følgende trekkes ikke fra tilgjengelige timer, selv om man er fraværende:",
                  ],
                },
                {
                  tag: "ul",
                  children: [
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Sykdom - egenmelding"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Sykt barn"],
                        },
                      ],
                    },
                    {
                      tag: "li",
                      children: [
                        {
                          tag: "p",
                          children: ["Avspasering"],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Denne beregningen er ikke helt nøyaktig, da vi ved sykemelding faktisk betaler lønn i arbeidsgiverperioden. I tillegg betaler vi et mellomlegg mellom Folketrygden og ansattes lønn ved foreldrepermisjon.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Fakturerbare timer"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Fakturerbare timer er alle timer som bemannes eller føres på fakturerbare timeføringskoder.",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Oppnådd timepris"],
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Oppnådd timepris (OT) betyr snittpris per time solgt i en viss periode. Dette kan regnes ut totalt for selskapet, eller for en spesifikk kunde. Oppnådd timepris beregnes slik:",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Oppnådd timepris = Total omsetning / Antall timer",
                  ],
                },
                {
                  tag: "p",
                  children: [
                    {
                      tag: "br",
                    },
                  ],
                },
                {
                  tag: "p",
                  children: [
                    "Merk at den totale omsetningen, deles på antall timer i fakturerbare prosjekter. Dersom man for eksempel rabatterer eller avskriver timer, vil dette påvirke oppnådd timepris.",
                  ],
                },
              ],
            },
          ],
          slug: "nyttig-aa-vite",
        },
      ],
      ingress: "Her finner du det meste du trenger å vite om å jobbe i Blank.",
      theme: "dark",
      title: "Personalhåndbok",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        ingress: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        chapters: {
          type: "array",
          item: {
            type: "object",
            items: {
              header: {
                type: "string",
                options: {},
                opt: false,
                raw: false,
              },
              sections: {
                type: "array",
                item: {
                  type: "object",
                  items: {
                    header: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                    slug: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                    text: {
                      type: "richtext",
                      opt: false,
                      options: {
                        style: {
                          bold: true,
                          italic: true,
                          lineThrough: true,
                        },
                        block: {
                          h1: true,
                          h2: true,
                          h3: true,
                          h4: true,
                          h5: true,
                          h6: true,
                          ul: true,
                          ol: true,
                        },
                        inline: {
                          a: true,
                          img: true,
                        },
                      },
                    },
                  },
                  opt: false,
                },
                opt: false,
              },
              slug: {
                type: "string",
                options: {},
                opt: false,
                raw: true,
              },
            },
            opt: false,
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/workingConditions.val.ts": {
    source: {
      conditions: [2, 3, 4, 5, 1, 7, 6, 9, 0, 8],
      description:
        "Det er vanskelig å orientere seg i markedet om hva som er konkurransedyktig lønn og vanlige goder. Derfor har kan du lese litt mer om våre betingelser og tankene bak her. Vi håper det kan være til nytte.",
      header: "Lønn og goder i Blank",
      theme: "dark",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        header: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        description: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        conditions: {
          type: "array",
          item: {
            type: "keyOf",
            path: "/content/workingConditions.val.ts",
            schema: {
              type: "array",
              item: {
                type: "object",
                items: {
                  title: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  content: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: false,
            values: "number",
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/services.val.ts": {
    source: {
      description:
        "Blank er full av flinke folk fra en bredt spekter av fagområder. Her er det vi kan.",
      header: "Hva vi leverer",
      metadataDescription:
        "Blank tilbyr et bredt utvalg av fagområder til dine behov.",
      metadataTitle: "Tjenester",
      theme: "dark",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        metadataTitle: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        metadataDescription: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        description: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        header: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/home.val.ts": {
    source: {
      theme: "dark",
      title: "Spesialister på digital produktutvikling",
      metadataTitle: "Spesialister på digital produktutvikling",
      metadataDescription:
        "Spesialister på digital produktutvikling og et litt annerledes konsulentselskap i Oslo. Designere og teknologer som lager bra greier for kundene våre og oss selv.",
      navLinks: [
        {
          url: "/digital-produktutvikling",
          title: "om oss",
        },
        {
          url: "/prosjekter",
          title: "portfolio",
        },
        {
          url: "/jobb",
          title: "jobbe i Blank",
        },
        {
          url: "/menneskene",
          title: "menneskene",
        },
        {
          url: "/handboka",
          title: "håndbok",
        },
      ],
      contactLinkTitle: "kontakt",
      hero: {
        header: "Alt er en test",
        intro:
          "I Blank dyrker vi åpenhet, tillit og fellesskap fordi vi mener at det gjør oss til norges beste konsulentselskap for kundene våre, men først og fremst for de som jobber her.\n",
        pictureStack: [
          {
            _ref: "/public/images/154770d74e04ec7a17f58a1c031a6430b586d1b8-4000x6000.webp",
            _type: "file",
            metadata: {
              width: 4000,
              height: 6000,
              sha256:
                "cb7108dca3c0a6941084af09d9dc6110b6ffad62facbf134d4f062d9bc12870c",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/f5fc7024f865385152aaf9abe210937a22b8fbbc-689x460.webp",
            _type: "file",
            metadata: {
              width: 689,
              height: 460,
              sha256:
                "5671e05a8cbe0f911b3944931bb627969657cf3b14960b48bbf4417715653c03",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/ce9866c87bf208c47f6ff022ea1109a848dfe1d3-960x795.webp",
            _type: "file",
            metadata: {
              width: 960,
              height: 795,
              sha256:
                "9e2146333b25bad4186c58cf3ed23793f91d86268ff72e0aa6e82fd10f959ba9",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/bd513a984361651b07d1a763878d7634e1e7e17f-5158x3443.webp",
            _type: "file",
            metadata: {
              width: 5158,
              height: 3443,
              sha256:
                "1c9c613483497ca7584be77d9d80011f421609eded1d9ee812fb0041535277dc",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/e9aa35b473381bb84a2ca9e60cee77ea002696e4-700x403.webp",
            _type: "file",
            metadata: {
              width: 700,
              height: 403,
              sha256:
                "224634ba3366ce0efb41cede5540589af9c5da7cf8d0c92fdc493f33a84513b2",
              mimeType: "image/webp",
            },
          },
        ],
      },
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        metadataTitle: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        metadataDescription: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        navLinks: {
          type: "array",
          item: {
            type: "object",
            items: {
              title: {
                type: "string",
                options: {},
                opt: false,
                raw: false,
              },
              url: {
                type: "string",
                options: {},
                opt: false,
                raw: true,
              },
            },
            opt: false,
          },
          opt: false,
        },
        contactLinkTitle: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        hero: {
          type: "object",
          items: {
            header: {
              type: "string",
              options: {},
              opt: false,
              raw: false,
            },
            intro: {
              type: "string",
              options: {},
              opt: false,
              raw: false,
            },
            pictureStack: {
              type: "array",
              item: {
                type: "image",
                opt: false,
              },
              opt: false,
            },
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/contactSales.val.ts": {
    source: {
      description:
        "Trenger du hjelp med design eller utvikling? Fyll ut skjemaet, vi hjelper deg gjerne!",
      formSuccessHeader: "Takk takk!",
      formSuccessText:
        "Gi oss litt tid til å se over infoen din, så tar vi kontakt! ",
      image: {
        _ref: "/public/images/3064b5e40967f1d1bea1d8dd95efa41ca26c96b0-1920x1281.webp",
        _type: "file",
        metadata: {
          width: 1920,
          height: 1281,
          sha256:
            "7d0e9cb55ee97320dbc5ed49c7b9660eca1ca0b6f392a82d4ca9718d73047308",
          mimeType: "image/webp",
        },
      },
      theme: "dark",
      title: "La oss hjelpe deg!",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        description: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        image: {
          type: "image",
          opt: false,
        },
        formSuccessHeader: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
        formSuccessText: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
      },
      opt: false,
    },
  },
  "/content/pages/employees.val.ts": {
    source: {
      theme: "dark",
      title: "Menneskene i Blank",
    },
    schema: {
      type: "object",
      items: {
        theme: {
          type: "union",
          key: {
            type: "literal",
            value: "light",
            opt: false,
          },
          items: [
            {
              type: "literal",
              value: "dark",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartLight",
              opt: false,
            },
            {
              type: "literal",
              value: "alternatingStartDark",
              opt: false,
            },
          ],
          opt: false,
        },
        title: {
          type: "string",
          options: {},
          opt: false,
          raw: false,
        },
      },
      opt: false,
    },
  },
  "/content/darkside.val.ts": {
    source: [
      {
        pictures: [
          {
            _ref: "/public/images/d16b762bb1d4d4169f0bc73c5ba20bed7ddcfd48-769x483.gif",
            _type: "file",
            metadata: {
              width: 769,
              height: 483,
              sha256:
                "022ed7b0ee836f0521b3e99a344e20f2b1aa36a390e6e7c687d692310cb844e8",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/b92675aa94d0be5a1b6a4462a161f964b0fc994a-767x475.jpg",
            _type: "file",
            metadata: {
              width: 767,
              height: 475,
              sha256:
                "45dab9f00ca74629c64e5c174b2e84aa2ce58f2c2731ec31ecfa8ddf729c4186",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1786900646cf93c1c8776a43cc5e6b5a99d75380-769x478.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 478,
              sha256:
                "2331c00e00acb718c49985d02f61595f67bd126896b1b6affbfc71086ca3109c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/f224b5c822d70774292244ed960190c86930351d-800x533.jpg",
            _type: "file",
            metadata: {
              width: 800,
              height: 533,
              sha256:
                "2f2ccbfbb0949f6eb5a802dab6b906de17602e901f279f20293f697edbc43930",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/59dccf0e6894b79beeff93fb4533ab30a122b368-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "3e50bb4d66c25c3f651165387220c01dfdfed726c17032a81db5ff376b5809c7",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/a0e565ddc3bd4ecf6426247cf2490f7807311174-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "db8dd40b18d2022b4c4fc50f162911ce6b479cfd39eb6e1d254a7afbd1ad7585",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6a50fbedb88dc54741bb4d7b9ac0a2cee831a2c6-672x732.gif",
            _type: "file",
            metadata: {
              width: 672,
              height: 732,
              sha256:
                "d285241d2cb9c32d2bb677598a0484055c3b51431a4e8fb2cfbd4ec1e9d5fa5a",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/ec06cf1adfd032051ce3573df8f2ad0e37f2cc64-770x482.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 482,
              sha256:
                "3097669393db5df08dcce7861a45bf1d022d14f9b8cf3c6c1fa71d3a0fd5c2b2",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/5f7792d782afe55df48f8567803ff198e5929486-900x600.jpg",
            _type: "file",
            metadata: {
              width: 900,
              height: 600,
              sha256:
                "420af304f09e5e9ba514293126f04de5332dc42e8f4f6737c411d888c1d88c53",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b1aa6ab1263f31c3a45fe331a53f1207d8da2001-768x481.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 481,
              sha256:
                "ac35c8bac2c11a0d572f7e02bae0a9417cc9832a52960cbecd0455a5f4fa9347",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1c1e024ce34b24a871c40380012ea2e2462a7979-900x678.gif",
            _type: "file",
            metadata: {
              width: 900,
              height: 678,
              sha256:
                "040681a1383275347b044136dc7de931812f835dcecd696daefe6045ca635091",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/fd663f7884ea244c7f3e40f4c4061602cec67f76-766x476.jpg",
            _type: "file",
            metadata: {
              width: 766,
              height: 476,
              sha256:
                "70902a1f01c4f62f0e1191a2de6a53ac19c4e7c1460adde6629b8533501cab8c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/765f6f138f9097d8342fc184630a9b6b4091f5b2-770x481.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 481,
              sha256:
                "a6b7dbfa6e107d7b4add88ee593dc26629e178ac7b60ae26c57b984bf0eceba0",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/67a72edd805f3fd4a384ee54120facd1b1523da2-770x484.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 484,
              sha256:
                "cf372cd0d2469f559f2d48fffe765dd4a0a7bc46ad475282666443fe7c939b06",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b5df69687309ea021eddf9b2598fc19f986be124-772x480.jpg",
            _type: "file",
            metadata: {
              width: 772,
              height: 480,
              sha256:
                "f4d81309bffad9215a7f9c6e5f857e543313216b2975f6945b0f3d3beda99ae1",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b1aa6ab1263f31c3a45fe331a53f1207d8da2001-768x481.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 481,
              sha256:
                "ac35c8bac2c11a0d572f7e02bae0a9417cc9832a52960cbecd0455a5f4fa9347",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/ec06cf1adfd032051ce3573df8f2ad0e37f2cc64-770x482.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 482,
              sha256:
                "3097669393db5df08dcce7861a45bf1d022d14f9b8cf3c6c1fa71d3a0fd5c2b2",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/4a38aea4e3d2e6fe4434b042f3d4a113ccac7d1e-768x1024.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 1024,
              sha256:
                "04bb0fd7895f094353636dbbd50a8ab59b525bfe80cbf024088e4a722f4ee166",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/e96be64a8a265e1a3477f47958dd8ad774bc8ba7-851x579.webp",
            _type: "file",
            metadata: {
              width: 851,
              height: 579,
              sha256:
                "7ffa9447b4972ba3899b98373e93d6d9569e6e1a46387b4e705f4966778f99d4",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/a0e565ddc3bd4ecf6426247cf2490f7807311174-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "db8dd40b18d2022b4c4fc50f162911ce6b479cfd39eb6e1d254a7afbd1ad7585",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1786900646cf93c1c8776a43cc5e6b5a99d75380-769x478.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 478,
              sha256:
                "2331c00e00acb718c49985d02f61595f67bd126896b1b6affbfc71086ca3109c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/dd1a00d09105a48318f07f6fe59b62c2fda55686-3601x3006.jpg",
            _type: "file",
            metadata: {
              width: 3601,
              height: 3006,
              sha256:
                "2a4d97cfc5200aa37651cd7be2e6647cea9f5320970c697a83aafff8694ac300",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/7bcbb7d374d7568df1266fe5ac3c4bec805733f0-600x684.jpg",
            _type: "file",
            metadata: {
              width: 600,
              height: 684,
              sha256:
                "c6e01020572119edcedd42c8b70510b352a3c117cab102601ff5babc8855fdca",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/59dccf0e6894b79beeff93fb4533ab30a122b368-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "3e50bb4d66c25c3f651165387220c01dfdfed726c17032a81db5ff376b5809c7",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/4f1002b09919822ecdbd67be8c3349189bb08400-768x477.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 477,
              sha256:
                "86ff5d185a0b757bcfbda5fe74b6329b2d39a00ebdf632b3e79cd36e6fb50689",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/c317b63ccc992fe212ab4d178e917bfb9a22f87c-722x1089.jpg",
            _type: "file",
            metadata: {
              width: 722,
              height: 1089,
              sha256:
                "ce2b9880f456ee8a3c3e23fd9ba09df49af0fad248f07beb96a12692020cb111",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6019d57c37c62ffaf81ed8210f39a69a6ac9bad3-768x476.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 476,
              sha256:
                "fb99155608d0f2d5357499ff43b55b3045e780721c8b8206bbd96a3b0fc1222d",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/a9f9e285efd8ba6a8146e663023574d08075bde9-2048x1365.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1365,
              sha256:
                "bccf6d0ee4922092e5b4991a71d53d8aa98b0b6391f091e2a97200e4c94e0f24",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6d059cc4be5eb0457721c4cf72653422c3fa9e54-3024x4032.jpg",
            _type: "file",
            metadata: {
              width: 3024,
              height: 4032,
              sha256:
                "cf5875a2c5addea240ec3981ca469f6dfb2ebed102722f2ef9926e66d7a5ba58",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/f414b152cb49a65509b019df0c4ebf1f5db1ce85-2048x1638.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1638,
              sha256:
                "a57fd903e96e396c18ba0eb08c1c9e93f2f9b548fac22a2d9542f9a245a549ac",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/5cddbe34565f434a6e1cb21f8a012b79395a1bd7-2048x1365.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1365,
              sha256:
                "717072edfdd4d585d13c01d6cdd2e12a71abb47701f3d58fea44e056d43e2b58",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/c2ca1d180f4df9e7a1877c728976aff2f3e0d5f2-4032x3024.jpg",
            _type: "file",
            metadata: {
              width: 4032,
              height: 3024,
              sha256:
                "4edb3e00e32763844023eca94d036acf5c25901cfd3c441fae9a7d4abe76e3e8",
              mimeType: "image/jpeg",
            },
          },
        ],
      },
      {
        pictures: [
          {
            _ref: "/public/images/d16b762bb1d4d4169f0bc73c5ba20bed7ddcfd48-769x483.gif",
            _type: "file",
            metadata: {
              width: 769,
              height: 483,
              sha256:
                "022ed7b0ee836f0521b3e99a344e20f2b1aa36a390e6e7c687d692310cb844e8",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/b92675aa94d0be5a1b6a4462a161f964b0fc994a-767x475.jpg",
            _type: "file",
            metadata: {
              width: 767,
              height: 475,
              sha256:
                "45dab9f00ca74629c64e5c174b2e84aa2ce58f2c2731ec31ecfa8ddf729c4186",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1786900646cf93c1c8776a43cc5e6b5a99d75380-769x478.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 478,
              sha256:
                "2331c00e00acb718c49985d02f61595f67bd126896b1b6affbfc71086ca3109c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/f224b5c822d70774292244ed960190c86930351d-800x533.jpg",
            _type: "file",
            metadata: {
              width: 800,
              height: 533,
              sha256:
                "2f2ccbfbb0949f6eb5a802dab6b906de17602e901f279f20293f697edbc43930",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/59dccf0e6894b79beeff93fb4533ab30a122b368-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "3e50bb4d66c25c3f651165387220c01dfdfed726c17032a81db5ff376b5809c7",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/a0e565ddc3bd4ecf6426247cf2490f7807311174-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "db8dd40b18d2022b4c4fc50f162911ce6b479cfd39eb6e1d254a7afbd1ad7585",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6a50fbedb88dc54741bb4d7b9ac0a2cee831a2c6-672x732.gif",
            _type: "file",
            metadata: {
              width: 672,
              height: 732,
              sha256:
                "d285241d2cb9c32d2bb677598a0484055c3b51431a4e8fb2cfbd4ec1e9d5fa5a",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/ec06cf1adfd032051ce3573df8f2ad0e37f2cc64-770x482.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 482,
              sha256:
                "3097669393db5df08dcce7861a45bf1d022d14f9b8cf3c6c1fa71d3a0fd5c2b2",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/5f7792d782afe55df48f8567803ff198e5929486-900x600.jpg",
            _type: "file",
            metadata: {
              width: 900,
              height: 600,
              sha256:
                "420af304f09e5e9ba514293126f04de5332dc42e8f4f6737c411d888c1d88c53",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b1aa6ab1263f31c3a45fe331a53f1207d8da2001-768x481.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 481,
              sha256:
                "ac35c8bac2c11a0d572f7e02bae0a9417cc9832a52960cbecd0455a5f4fa9347",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1c1e024ce34b24a871c40380012ea2e2462a7979-900x678.gif",
            _type: "file",
            metadata: {
              width: 900,
              height: 678,
              sha256:
                "040681a1383275347b044136dc7de931812f835dcecd696daefe6045ca635091",
              mimeType: "image/gif",
            },
          },
          {
            _ref: "/public/images/fd663f7884ea244c7f3e40f4c4061602cec67f76-766x476.jpg",
            _type: "file",
            metadata: {
              width: 766,
              height: 476,
              sha256:
                "70902a1f01c4f62f0e1191a2de6a53ac19c4e7c1460adde6629b8533501cab8c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/765f6f138f9097d8342fc184630a9b6b4091f5b2-770x481.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 481,
              sha256:
                "a6b7dbfa6e107d7b4add88ee593dc26629e178ac7b60ae26c57b984bf0eceba0",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/67a72edd805f3fd4a384ee54120facd1b1523da2-770x484.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 484,
              sha256:
                "cf372cd0d2469f559f2d48fffe765dd4a0a7bc46ad475282666443fe7c939b06",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b5df69687309ea021eddf9b2598fc19f986be124-772x480.jpg",
            _type: "file",
            metadata: {
              width: 772,
              height: 480,
              sha256:
                "f4d81309bffad9215a7f9c6e5f857e543313216b2975f6945b0f3d3beda99ae1",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/b1aa6ab1263f31c3a45fe331a53f1207d8da2001-768x481.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 481,
              sha256:
                "ac35c8bac2c11a0d572f7e02bae0a9417cc9832a52960cbecd0455a5f4fa9347",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/ec06cf1adfd032051ce3573df8f2ad0e37f2cc64-770x482.jpg",
            _type: "file",
            metadata: {
              width: 770,
              height: 482,
              sha256:
                "3097669393db5df08dcce7861a45bf1d022d14f9b8cf3c6c1fa71d3a0fd5c2b2",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/4a38aea4e3d2e6fe4434b042f3d4a113ccac7d1e-768x1024.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 1024,
              sha256:
                "04bb0fd7895f094353636dbbd50a8ab59b525bfe80cbf024088e4a722f4ee166",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/e96be64a8a265e1a3477f47958dd8ad774bc8ba7-851x579.webp",
            _type: "file",
            metadata: {
              width: 851,
              height: 579,
              sha256:
                "7ffa9447b4972ba3899b98373e93d6d9569e6e1a46387b4e705f4966778f99d4",
              mimeType: "image/webp",
            },
          },
          {
            _ref: "/public/images/a0e565ddc3bd4ecf6426247cf2490f7807311174-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "db8dd40b18d2022b4c4fc50f162911ce6b479cfd39eb6e1d254a7afbd1ad7585",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/1786900646cf93c1c8776a43cc5e6b5a99d75380-769x478.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 478,
              sha256:
                "2331c00e00acb718c49985d02f61595f67bd126896b1b6affbfc71086ca3109c",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/dd1a00d09105a48318f07f6fe59b62c2fda55686-3601x3006.jpg",
            _type: "file",
            metadata: {
              width: 3601,
              height: 3006,
              sha256:
                "2a4d97cfc5200aa37651cd7be2e6647cea9f5320970c697a83aafff8694ac300",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/7bcbb7d374d7568df1266fe5ac3c4bec805733f0-600x684.jpg",
            _type: "file",
            metadata: {
              width: 600,
              height: 684,
              sha256:
                "c6e01020572119edcedd42c8b70510b352a3c117cab102601ff5babc8855fdca",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/59dccf0e6894b79beeff93fb4533ab30a122b368-769x479.jpg",
            _type: "file",
            metadata: {
              width: 769,
              height: 479,
              sha256:
                "3e50bb4d66c25c3f651165387220c01dfdfed726c17032a81db5ff376b5809c7",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/4f1002b09919822ecdbd67be8c3349189bb08400-768x477.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 477,
              sha256:
                "86ff5d185a0b757bcfbda5fe74b6329b2d39a00ebdf632b3e79cd36e6fb50689",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/c317b63ccc992fe212ab4d178e917bfb9a22f87c-722x1089.jpg",
            _type: "file",
            metadata: {
              width: 722,
              height: 1089,
              sha256:
                "ce2b9880f456ee8a3c3e23fd9ba09df49af0fad248f07beb96a12692020cb111",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6019d57c37c62ffaf81ed8210f39a69a6ac9bad3-768x476.jpg",
            _type: "file",
            metadata: {
              width: 768,
              height: 476,
              sha256:
                "fb99155608d0f2d5357499ff43b55b3045e780721c8b8206bbd96a3b0fc1222d",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/a9f9e285efd8ba6a8146e663023574d08075bde9-2048x1365.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1365,
              sha256:
                "bccf6d0ee4922092e5b4991a71d53d8aa98b0b6391f091e2a97200e4c94e0f24",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/6d059cc4be5eb0457721c4cf72653422c3fa9e54-3024x4032.jpg",
            _type: "file",
            metadata: {
              width: 3024,
              height: 4032,
              sha256:
                "cf5875a2c5addea240ec3981ca469f6dfb2ebed102722f2ef9926e66d7a5ba58",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/f414b152cb49a65509b019df0c4ebf1f5db1ce85-2048x1638.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1638,
              sha256:
                "a57fd903e96e396c18ba0eb08c1c9e93f2f9b548fac22a2d9542f9a245a549ac",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/5cddbe34565f434a6e1cb21f8a012b79395a1bd7-2048x1365.jpg",
            _type: "file",
            metadata: {
              width: 2048,
              height: 1365,
              sha256:
                "717072edfdd4d585d13c01d6cdd2e12a71abb47701f3d58fea44e056d43e2b58",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/c2ca1d180f4df9e7a1877c728976aff2f3e0d5f2-4032x3024.jpg",
            _type: "file",
            metadata: {
              width: 4032,
              height: 3024,
              sha256:
                "4edb3e00e32763844023eca94d036acf5c25901cfd3c441fae9a7d4abe76e3e8",
              mimeType: "image/jpeg",
            },
          },
          {
            _ref: "/public/images/ac61b04793b089a3d19393f29f5d4399019e394e-600x1100.gif",
            _type: "file",
            metadata: {
              width: 600,
              height: 1100,
              sha256:
                "7f46a3a56aeebc32de2dc0acf973531723403e46731162ff73a9a7cc5bdf4287",
              mimeType: "image/gif",
            },
          },
        ],
      },
    ],
    schema: {
      type: "array",
      item: {
        type: "object",
        items: {
          pictures: {
            type: "array",
            item: {
              type: "image",
              opt: false,
            },
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/salary.val.ts": {
    source: {
      Blank: {
        color: "#FFFCB6",
        data: [
          {
            year: "2022",
            amount: "695000",
          },
          {
            year: "2021",
            amount: "735000",
          },
          {
            year: "2020",
            amount: "780000",
          },
          {
            year: "2019",
            amount: "830000",
          },
          {
            year: "2018",
            amount: "875000",
          },
          {
            year: "2017",
            amount: "920000",
          },
          {
            year: "2016",
            amount: "960000",
          },
          {
            year: "2015",
            amount: "990000",
          },
          {
            year: "2014",
            amount: "1020000",
          },
          {
            year: "2013",
            amount: "1050000",
          },
          {
            year: "2012",
            amount: "1075000",
          },
          {
            year: "2011",
            amount: "1100000",
          },
          {
            year: "2010",
            amount: "1120000",
          },
          {
            year: "2009",
            amount: "1140000",
          },
          {
            year: "2008",
            amount: "1160000",
          },
          {
            year: "2007",
            amount: "1180000",
          },
          {
            year: "2006",
            amount: "1195000",
          },
          {
            year: "2005",
            amount: "1210000",
          },
          {
            year: "2004",
            amount: "1220000",
          },
          {
            year: "2003",
            amount: "1230000",
          },
          {
            year: "2002",
            amount: "1240000",
          },
          {
            year: "2001",
            amount: "1250000",
          },
          {
            year: "2000",
            amount: "1260000",
          },
          {
            year: "1999",
            amount: "1270000",
          },
          {
            year: "1998",
            amount: "1280000",
          },
          {
            year: "1997",
            amount: "1290000",
          },
          {
            year: "1996",
            amount: "1300000",
          },
        ],
      },
      "Tekna privat, øvre kvartil": {
        color: "rgb(255, 0, 0)",
        data: [
          {
            year: "2022",
            amount: "607500",
          },
          {
            year: "2021",
            amount: "651600",
          },
          {
            year: "2020",
            amount: "715000",
          },
          {
            year: "2019",
            amount: "758000",
          },
          {
            year: "2018",
            amount: "802348",
          },
          {
            year: "2017",
            amount: "833000",
          },
          {
            year: "2016",
            amount: "880000",
          },
          {
            year: "2015",
            amount: "900000",
          },
          {
            year: "2014",
            amount: "918000",
          },
          {
            year: "2013",
            amount: "955000",
          },
          {
            year: "2012",
            amount: "990779",
          },
          {
            year: "2011",
            amount: "1014874",
          },
          {
            year: "2010",
            amount: "1050000",
          },
          {
            year: "2009",
            amount: "1054000",
          },
          {
            year: "2008",
            amount: "1105000",
          },
          {
            year: "2007",
            amount: "1107635",
          },
          {
            year: "2006",
            amount: "1122900",
          },
          {
            year: "2005",
            amount: "1157322",
          },
          {
            year: "2004",
            amount: "1200000",
          },
          {
            year: "2003",
            amount: "1226716",
          },
          {
            year: "2002",
            amount: "1230000",
          },
          {
            year: "2001",
            amount: "1233500",
          },
          {
            year: "2000",
            amount: "1218713",
          },
          {
            year: "1999",
            amount: "1279000",
          },
          {
            year: "1998",
            amount: "1297000",
          },
          {
            year: "1997",
            amount: "1300000",
          },
          {
            year: "1996",
            amount: "1310000",
          },
        ],
      },
      "Tekna data/IT, øvre kvartil": {
        color: "rgb(0, 255, 0)",
        data: [
          {
            year: "2022",
            amount: "620000",
          },
          {
            year: "2021",
            amount: "680000",
          },
          {
            year: "2020",
            amount: "750000",
          },
          {
            year: "2019",
            amount: "800000",
          },
          {
            year: "2018",
            amount: "860000",
          },
          {
            year: "2017",
            amount: "900000",
          },
          {
            year: "2016",
            amount: "955725",
          },
          {
            year: "2015",
            amount: "961368",
          },
          {
            year: "2014",
            amount: "991000",
          },
          {
            year: "2013",
            amount: "1085000",
          },
          {
            year: "2012",
            amount: "1042450",
          },
          {
            year: "2011",
            amount: "1050000",
          },
          {
            year: "2010",
            amount: "1145000",
          },
          {
            year: "2009",
            amount: "1071293",
          },
          {
            year: "2008",
            amount: "1150000",
          },
          {
            year: "2007",
            amount: "1130000",
          },
          {
            year: "2006",
            amount: "1162000",
          },
          {
            year: "2005",
            amount: "1152500",
          },
          {
            year: "2004",
            amount: "1225000",
          },
          {
            year: "2003",
            amount: "1300000",
          },
          {
            year: "2002",
            amount: "1230000",
          },
          {
            year: "2001",
            amount: "1164000",
          },
          {
            year: "2000",
            amount: "1200000",
          },
          {
            year: "1999",
            amount: "1300000",
          },
          {
            year: "1998",
            amount: "1225000",
          },
          {
            year: "1997",
            amount: "1293620",
          },
          {
            year: "1996",
            amount: "1176382",
          },
        ],
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          color: {
            type: "string",
            options: {},
            opt: false,
            raw: true,
          },
          data: {
            type: "array",
            item: {
              type: "object",
              items: {
                year: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: true,
                },
                amount: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: true,
                },
              },
              opt: false,
            },
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/workingConditions.val.ts": {
    source: [
      {
        content: [
          {
            tag: "p",
            children: [
              "Vi synes pensjon er viktig og har derfor en god, men enkel, pensjonsordning som innbetaler 5,5 prosent av din fastlønn fra første krone og opp til 12 G.",
            ],
          },
          {
            tag: "p",
            children: ["Noen eksempler med en årslønn på 600 000,-:"],
          },
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  _ref: "/public/images/aa1accece059ad2ff6cdc673b2e65db7a5dcfe1e-373x98.webp",
                  _type: "file",
                  metadata: {
                    width: 373,
                    height: 98,
                    mimeType: "image/webp",
                    sha256:
                      "b695c20293b2bac01e3c2b546cc347ce2d41f88c6de7984458bf1b7d63601c7d",
                  },
                },
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  _ref: "/public/images/d9be5aa3f2dcdae6057d9c0f5e05d35908380a6d-383x98.webp",
                  _type: "file",
                  metadata: {
                    width: 383,
                    height: 98,
                    mimeType: "image/webp",
                    sha256:
                      "a1217c8fea9c3b9d3ae393748ce17a6023f77d19811016f52052713d9a270891",
                  },
                },
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  _ref: "/public/images/d9dcce99dad5a19b866879878624a14adde79c58-529x98.webp",
                  _type: "file",
                  metadata: {
                    width: 529,
                    height: 98,
                    mimeType: "image/webp",
                    sha256:
                      "18365603f9c3017e1b8b1800619c0587e61074f40a80f65bdff323cc7a38f932",
                  },
                },
              },
            ],
          },
        ],
        title: "Pensjon",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Alle konsulentene i Blank har rett til overtidsbetaling. Overtidsbetalingen finner du ved å dele årslønn på 1950 timer og legge på 40 %.",
              {
                tag: "br",
              },
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Eksempelvis:"],
          },
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  _ref: "/public/images/7717ed69ad8dcd7d71f0f210f9de9d27602cc6d9-505x57.webp",
                  _type: "file",
                  metadata: {
                    width: 505,
                    height: 57,
                    mimeType: "image/webp",
                    sha256:
                      "8470809c6edd46425ef0c5a37b7794cbbff7080b11344686b2ec410692f381d4",
                  },
                },
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Overtidsbetalingen gjelder for pålagt overtid. Når du er på et kundeprosjekt eller -engasjement, bestemmer du i stor grad dette selv, med mindre kunden har strikte retningslinjer. Med andre ord får du i praksis betalt for alle timer når du er på prosjekt eller engasjement. Interntid må være avtalt for å telle som overtid.",
            ],
          },
        ],
        title: "Overtidsbetaling",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "For å bestemme fastlønn har vi helt siden starten hatt som mål å gjøre det enkelt og åpent. Vi har god oversikt over lønnsnivået i bransjen, og etter å ha studert ulike tall og statistikker, bestemte vi oss for å ta utgangspunkt i Teknas lønnsstatistikk. Grafen for øvre kvartil i privat sektor var nærmest der vi tenkte vi skulle være. Denne trengte bare litt glatting og kjærlighet før vi kunne benytte denne som lønnsstige. Variasjoner vil selvsagt eksistere – for eksempel ved at enkeltpersoner kan bli forfremmet fra sitt eksamenskull – men siden vi har åpne lønnsbøker må slike avgjørelser i så tilfelle kunne forsvares av ledelsen.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Lønnen din beregnes ut fra hvilket år du avsluttet utdanningen din.\nX= Uteksamineringsår, Y= Ca lønn i Blank.",
            ],
          },
        ],
        title: "Fastlønn",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Alle som får tilbud om ansettelse i Blank får tilbud om å kjøpe aksjer i selskapet og dermed bli medeiere. Medeierskap er en del av grunnfilosofien i Blank og vil fortsette i overskuelig framtid. Det er viktig for oss at tilbudet om å kjøpe aksjer kommer fra Blank og ikke fra en av de eksisterende aksjeeierne. Dette da vi ønsker at ditt innskudd skal gå til å gjøre Blank sterkere. Prissettingen av aksjene tar utgangspunkt i selskapets egenkapital og legger dette sammen med en verdisetting av antall ansatte i selskapet før neste emisjonspulje er startet. Per Q4 2016 er hver emisjonspulje på omtrent 10 stk.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Merk at aksjedelen av tilbudet er nettopp det — et tilbud. Man må ikke eie aksjer for å jobbe i Blank, men vi ønsker å gi alle denne muligheten.",
            ],
          },
        ],
        title: "Medeierskap",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Den første fredagen i hver måned samler vi hele Blank til «Innedag». Dette er en dag hvor hele selskapet tar fri fra prosjekt og kundeengasjementer for å drive fagutvikling.",
            ],
          },
          {
            tag: "p",
            children: ["I dag har vi i hovedsak to typer Innedager:  "],
          },
          {
            tag: "ul",
            children: [
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Fasiliterte dager med workshoper og foredrag  ",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Åpne dager hvor hver enkelt selv bestemmer"],
                  },
                ],
              },
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "På de åpne dagene er det opp til hver enkelt hva man bruker dagen til, men etter prinsippet om at det skal gagne Blank.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "I tillegg til Innedagene, kan man delta på eksterne aktiviteter som konferanser, kurs eller ekskursjoner. Vi har en føring om at alle har mulighet til å dra på minst én ekstern aktivitet i året, men at det vises skjønn hvis man ønsker å delta på flere. Dagskurs, seminarer, foredrag med lavere kostnader kommer utenom dette. Man skal vurdere hyppighet og totalkostnad på slike aktiviteter. Hovedføringen er igjen at de skal gagne Blank.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Ved bidrag til arrangementer i form av foredrag eller kurs, går dette selvfølgelig utenom. Vi ønsker å bidra tilbake til fagmiljøet og oppfordrer til dette, samtidig som slike bidrag er en viktig måte å promotere Blank, både for nye kunder og framtidig ansatte.",
            ],
          },
        ],
        title: "Fagutvikling",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Når det kommer til ferie, kjører vi standarden fra ferieloven – fem ukers betalt ferie. Forøvrig regner vi alle arbeidsdager fra og med julaften til og med nyttårsaften som helligdager. Dette betyr at man ikke trenger å benytte egen ferie eller avspasering mellom jul og nyttår.",
            ],
          },
        ],
        title: "Ferie",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Et av de viktigste momentene for oss i Blank er tillit til hver enkelt ansatt. Dette benytter vi også når det kommer til egenmeldingsdager, hvor hver av oss har tolv frie enkeltdager per kalenderår som kan benyttes de gangene vi er syke. Disse dagene kan benyttes enkeltvis eller sammenhengende. Hvis disse tolv sykedagene blir brukt opp, gjelder regler om sykemelding som ellers i arbeidslivet.",
            ],
          },
        ],
        title: "Tolv egenmeldingsdager",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Kjernetiden i Blank er fra 10 til 14, men tilpasses til våre kunder. Hos mange vil dette være 9 til 15. Her må du forholde seg til hva som er praksis på ditt kundeengasjement.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: [
              "Vi praktiserer en avspaseringsordning hvor hver enkelt har en «tidskonto» som kan være opptil et ukesverk i pluss eller minus. Innenfor dette står du fritt til spare opp og ta ut avspasering — også før denne er opptjent. Husk bare at det fortsatt er viktig å gi beskjed til de rundt deg om planlagt fravær — selv om dette er avspasering.",
            ],
          },
        ],
        title: "Avspasering og timekonto",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Vi dekker i dag mange forsikringer for våre arbeidstakere. Nøyaktige vilkår og oversikt ligger i forsikringspapirene alle får tilsendt, men er pt.:  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Reiseforsikring"],
          },
          {
            tag: "p",
            children: [
              "Blank dekker reiseforsikring hos Gouda for deg, samboer og barn. Forsikringen gjelder reiser i hele verden inntil 45 dager, også fritidsreiser.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Behandling/helseforsikring"],
          },
          {
            tag: "p",
            children: [
              "Alle ansatte har tilgang til ubegrenset medisinsk rådgivning over telefon. I tillegg dekkes, for tilfeller som det offentlige helsevesen ikke dekker eller har lang ventetid, konsultasjon, operasjon, fysioterapi, rehabilitering, reise og opphold, psykologisk førstehjelp og psykolog.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Uførepensjon"],
          },
          {
            tag: "p",
            children: [
              "Denne forsikringen sikrer deg en månedlig utbetaling frem til du blir pensjonist og gir deg 69 % av fastlønn opp til 12 G minus uførepensjon fra folketrygden. I tillegg kommer 10 % av 1 G som en ekstra utbetaling på toppen – uavhengig av lønnsnivå.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Yrkesskade / yrkessykdom"],
          },
          {
            tag: "p",
            children: [
              "Gir en engangsutbetaling i de tilfeller man pådrar seg en skade eller sykdom gjennom jobb eller reise til og fra arbeid som gjør at man ikke kan jobbe fullt eller noe i det hele tatt.  ",
            ],
          },
          {
            tag: "p",
            children: [
              {
                tag: "br",
              },
            ],
          },
          {
            tag: "p",
            children: ["Innskuddsfritak"],
          },
          {
            tag: "p",
            children: [
              "Dersom du blir minst 20 % ufør, dekker denne forsikringen innbetalinger til din pensjonskonto frem til du blir 67 år, utfra din lønn på det tidspunktet du ble ufør.",
            ],
          },
        ],
        title: "Forsikringer",
      },
      {
        content: [
          {
            tag: "p",
            children: [
              "Hva enn av utstyr eller programvare du trenger for å gjøre jobben din, står du fritt til å kjøpe det inn. Behovet stoler vi på at du vurderer bedre enn ledelsen. Det eneste vi ønsker er at du oppdaterer den interne utstyrs- eller abonnementslisten.  ",
            ],
          },
          {
            tag: "p",
            children: ["I tillegg dekker vi:"],
          },
          {
            tag: "ul",
            children: [
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Internett hjemme inntil 750 kr inkl. mva i måneden",
                    ],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: ["Fri mobil i Europa, eksl. innholdstjenester"],
                  },
                ],
              },
              {
                tag: "li",
                children: [
                  {
                    tag: "p",
                    children: [
                      "Ubegrenset innkjøp av fagbøker – både elektroniske og papirutgaver",
                    ],
                  },
                ],
              },
            ],
          },
        ],
        title: "Utstyr og programvare",
      },
    ],
    schema: {
      type: "array",
      item: {
        type: "object",
        items: {
          title: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          content: {
            type: "richtext",
            opt: false,
            options: {
              style: {
                bold: true,
                italic: true,
                lineThrough: true,
              },
              block: {
                h1: true,
                h2: true,
                h3: true,
                h4: true,
                h5: true,
                h6: true,
                ul: true,
                ol: true,
              },
              inline: {
                a: true,
                img: true,
              },
            },
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/footer.val.ts": {
    source: {
      main: {
        header: "Snakke med oss",
        items: [
          {
            text: "Snakk med salg!",
            href: "/prosjektprat",
            newTab: false,
            divider: false,
          },
          {
            text: "Ta en prat om jobb",
            href: "/kaffeprat",
            newTab: false,
            divider: true,
          },
          {
            text: "innboks@blank.no",
            href: "mailto:innboks@blank.no",
            newTab: false,
            divider: false,
          },
          {
            text: "22 20 40 00",
            href: "tel:22204000",
            newTab: false,
            divider: false,
          },
        ],
      },
      sections: [
        {
          items: [
            {
              href: "https://www.blank.no/handboka",
              text: "Håndboka",
              newTab: false,
              divider: false,
            },
          ],
          header: "Mer om oss",
        },
        {
          header: "Følg oss",
          items: [
            {
              text: "Håndboka",
              href: "/handboka",
              newTab: false,
              divider: false,
            },
            {
              text: "Blogg",
              href: "https://blogg.blank.no/",
              newTab: true,
              divider: false,
            },
            {
              text: "Facebook",
              href: "https://www.facebook.com/blankoslo",
              newTab: true,
              divider: false,
            },
            {
              text: "Instagram",
              href: "https://www.instagram.com/blankoslo/",
              newTab: true,
              divider: false,
            },
            {
              text: "LinkedIn",
              href: "https://no.linkedin.com/company/blankas",
              newTab: true,
              divider: false,
            },
            {
              text: "Kjøregår",
              href: "/events",
              newTab: false,
              divider: false,
            },
          ],
        },
        {
          header: "Finn oss",
          items: [
            {
              text: "Blank AS",
              href: null,
              newTab: false,
              divider: false,
            },
            {
              text: "Torggata 15",
              href: "https://goo.gl/maps/7nU5pofgdSm",
              newTab: true,
              divider: false,
            },
            {
              text: "0181 Oslo",
              href: null,
              newTab: false,
              divider: false,
            },
            {
              text: "Org. nr: 915 433 073",
              href: null,
              newTab: false,
              divider: false,
            },
          ],
        },
      ],
    },
    schema: {
      type: "object",
      items: {
        main: {
          type: "object",
          items: {
            header: {
              type: "string",
              options: {},
              opt: false,
              raw: false,
            },
            items: {
              type: "array",
              item: {
                type: "object",
                items: {
                  text: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  href: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: true,
                  },
                  newTab: {
                    type: "boolean",
                    opt: false,
                  },
                  divider: {
                    type: "boolean",
                    opt: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
          },
          opt: false,
        },
        sections: {
          type: "array",
          item: {
            type: "object",
            items: {
              header: {
                type: "string",
                options: {},
                opt: false,
                raw: false,
              },
              items: {
                type: "array",
                item: {
                  type: "object",
                  items: {
                    text: {
                      type: "string",
                      options: {},
                      opt: false,
                      raw: false,
                    },
                    href: {
                      type: "string",
                      options: {},
                      opt: true,
                      raw: true,
                    },
                    newTab: {
                      type: "boolean",
                      opt: false,
                    },
                    divider: {
                      type: "boolean",
                      opt: false,
                    },
                  },
                  opt: false,
                },
                opt: false,
              },
            },
            opt: false,
          },
          opt: false,
        },
      },
      opt: false,
    },
  },
  "/content/services.val.ts": {
    source: {
      tjenestedesign: {
        header: "Tjenestedesign",
        heroImage: null,
        intro:
          "En tjenestedesigners oppgave er å se en hel tjeneste under ett og sørge for at brukerene får en så smidig og helhetlig opplevelse som mulig.",
        metadataDescription:
          "En tjenestedesigners oppgave er å se en hel tjeneste under ett og sørge for at brukerene får en så smidig og helhetlig opplevelse som mulig.",
        metadataTitle: "Tjenestedesign",
        sections: [
          {
            body: [
              {
                tag: "p",
                children: [
                  "Tjenestedesign er en menneskesentrert tilnærming til design som hjelper deg å forstå helheten i økosystemet som utgjør tjenesten din. og å få oversikt over utfordringer med stor kompleksitet. Du får innsikt i kundens opplevelse, behov og effektene det har for bedriften. Forstår du hvordan kundene opplever tjenesten din, kan du avdekke både sentrale utfordringer og muligheter for forbedring, videreutvikling og innovasjon.",
                ],
              },
            ],
            title: "Hva er tjenestedesign?",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "Tjenestedesignere fasiliterer en innsiktsdrevet, tverrfaglig og involverende prosess for samskaping og utvikling. Vi bruker denne prosessen til å forbedre brukeropplevelsen i eksisterende tjenester eller til å skape helt nye.",
                ],
              },
            ],
            title: "Hva gjør en tjenestedesigner?",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "Våre prisbelønte tjenestedesignere er med deg hele veien fra innsikt og konseptutvikling til tjenestene er bygd, brukes og videreutvikles. ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Vi er lidenskapelig opptatt av å skape gode, helhetlige og effektfulle produkter og opplevelser og gjør det gjennom kombinasjon av strategisk tenkning og kreativitet.",
                ],
              },
            ],
            title: "Jobbe med oss?",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "Våre tjenestedesignere har jobbet med blant annet Ice, Morgenlevering, ",
                  {
                    tag: "a",
                    href: "http://finn.no",
                    children: ["Finn.no"],
                  },
                  " og Remarkable og har lang erfaring med metoder og verktøy som:",
                ],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: ["Fasilitering av prosesser og workshoper"],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Visualisering av bruker,- kunde,- tjenestereiser",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Innsiktsinnhenting gjennom kvalitative og kvantitative metoder",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Visualisering, prototyping, pilotering og brukertesting",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Sette gode rammer og mål, og avdekke effekt",
                        ],
                      },
                    ],
                  },
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "p",
                        children: [
                          "Bred involvering i prosessen og opplæring i tjenestedesignmetodikk",
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            title: "Erfaring",
          },
        ],
        teaserDescription: "Konseptutvikling, produktutvikling, og ledelse",
        theme: "dark",
      },
      "interaksjonsdesign-og-brukeropplevelse-ux": {
        header: "Interaksjon- og brukeropplevelse",
        heroImage: null,
        intro: null,
        metadataDescription:
          "Interaksjonsdesign handler om å gi form til digitale produkter og tjenester slik som nettsider, fagsystemer, selvbetjeningsløsninger, mobilapper, spill og digitale løsninger som er integrert i fysiske produkter. ",
        metadataTitle: "Interaksjonsdesign og brukeropplevelse",
        sections: [
          {
            body: [
              {
                tag: "p",
                children: [
                  "Interaksjonsdesign handler om å gi form til digitale produkter og tjenester slik som nettsider, fagsystemer, selvbetjeningsløsninger, mobilapper, spill og digitale løsninger som er integrert i fysiske produkter.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Interaksjonsdesign tar sikte på å forbedre brukervennligheten og opplevelsen av disse produktene og systemene gjennom å forstå brukernes mål, kompetanse, forventninger, atferd og behov, og deretter designe løsninger som støtter opp under disse.",
                ],
              },
            ],
            title: "Interaksjonsdesign",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "UX (user experience) eller brukeropplevelse handler om det enda større bildet. UX handler om alle aspekter som bidrar til opplevelsen du får når du interagerer med et system, et produkt eller en tjeneste. Den helhetlige brukeropplevelsen vil være påvirket av alt fra visuell identitet, innpakning, kundeservice, tilgjengelighet, effektive brukergrensesnitt, bruksanvisninger og andre egenskaper ved tjenesten.",
                ],
              },
            ],
            title: "UX",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "Å investere i god design er både smart og lønnsomt. Brukervennlige løsninger bidrar til å effektivisere arbeidsprosesser, reduserer feil og korter ned tiden det tar å lære seg systemet. God design kan bidra til økt salg, konvertering og måloppnåelse og mer fornøyde kunder og økt kundelojalitet over tid.",
                ],
              },
            ],
            title: "Effekten av god design",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "For å passe på at vi løser riktig problem, og at produktet gir en best mulig brukeropplevelse for de som skal bruke produktet, jobber interaksjonsdesignere etter en holistisk og brukersentrert prosess.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Designprosessen tar utgangspunkt i å bygge forståelse for forretningsmål, problemet som skal løses, menneskene vi løser det for og konteksten det skal brukes i, slik at vi kan designe, prototype, bygge og teste iterativt til vi har skapt et produkt som er effektivt, brukervennlig og gir en helhetlig og velegnet brukeropplevelse.",
                ],
              },
            ],
            title: "Slik jobber en interaksjonsdesigner",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "Som designere bruker en rekke strukturerte metoder for å skaffe oss kunnskap om det vi skal designe, generere mulige løsninger, evaluere ideer og gi løsningene form og identitet. De aller vanligste er observasjonsstudier, brukertesting, intervjuer, statistikk og ulike typer workshops. Innsikten fra datainnsamling og analyse vil ofte bli visualisert gjennom brukerreiser, personas, diagrammer, videoprototyper og liknende slik at alle interessenter kan ta del i kunnskapen. Designere jobber vanligvis integrert i utviklerteam hvor de er viktige for bygge en strukturert utviklingsprosess sammen med programmerere.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "I digital produktutvikling jobber vi som regel integrert i agile utviklerteam hvor løsninger blir utviklet i tett samarbeid med programmerere, forretningsfolk og andre eksperter.",
                ],
              },
            ],
            title: "Metoder",
          },
          {
            body: [
              {
                tag: "p",
                children: [
                  "I Blank har vi et sterkt fagmiljø av designere som er spesialister på design av digitale produkter og tjenester. Våre prisbelønte designere er med deg gjennom hele designprosessen, helt fra problemdefinisjon til produktet er lansert og i aktiv bruk.  ",
                ],
              },
              {
                tag: "p",
                children: [
                  "Trenger du hjelp med design tar vi gjerne en prat.",
                ],
              },
            ],
            title: "Designere fra Blank",
          },
        ],
        teaserDescription: null,
        theme: "dark",
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          header: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          heroImage: {
            type: "image",
            opt: true,
          },
          theme: {
            type: "union",
            key: {
              type: "literal",
              value: "light",
              opt: false,
            },
            items: [
              {
                type: "literal",
                value: "dark",
                opt: false,
              },
              {
                type: "literal",
                value: "alternatingStartLight",
                opt: false,
              },
              {
                type: "literal",
                value: "alternatingStartDark",
                opt: false,
              },
            ],
            opt: false,
          },
          intro: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
          metadataDescription: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          metadataTitle: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          sections: {
            type: "array",
            item: {
              type: "object",
              items: {
                body: {
                  type: "richtext",
                  opt: false,
                  options: {
                    style: {
                      bold: true,
                      italic: true,
                      lineThrough: true,
                    },
                    block: {
                      h1: true,
                      h2: true,
                      h3: true,
                      h4: true,
                      h5: true,
                      h6: true,
                      ul: true,
                      ol: true,
                    },
                    inline: {
                      a: true,
                      img: true,
                    },
                  },
                },
                title: {
                  type: "string",
                  options: {},
                  opt: false,
                  raw: false,
                },
              },
              opt: false,
            },
            opt: false,
          },
          teaserDescription: {
            type: "string",
            options: {},
            opt: true,
            raw: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/availablePositions.val.ts": {
    source: [
      {
        description: "Bli designer i Blank!",
        order: 1,
        positionSlug: "designer",
        title: "Designer",
        active: true,
      },
      {
        description: "Bli teknolog i Blank!",
        order: 2,
        positionSlug: "teknolog",
        title: "Teknolog",
        active: true,
      },
    ],
    schema: {
      type: "array",
      item: {
        type: "object",
        items: {
          title: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          positionSlug: {
            type: "keyOf",
            path: "/content/pages/positions.val.ts",
            schema: {
              type: "record",
              item: {
                type: "object",
                items: {
                  header: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  intro: {
                    type: "richtext",
                    opt: false,
                    options: {
                      style: {
                        bold: true,
                        italic: true,
                        lineThrough: true,
                      },
                      block: {
                        h1: true,
                        h2: true,
                        h3: true,
                        h4: true,
                        h5: true,
                        h6: true,
                        ul: true,
                        ol: true,
                      },
                      inline: {
                        a: true,
                        img: true,
                      },
                    },
                  },
                  metadataIntro: {
                    type: "string",
                    options: {},
                    opt: true,
                    raw: false,
                  },
                  applyUrl: {
                    type: "string",
                    options: {},
                    opt: false,
                    raw: false,
                  },
                  contact: {
                    type: "keyOf",
                    path: "/content/employees/contactEmployees.val.ts",
                    schema: {
                      type: "array",
                      item: {
                        type: "object",
                        items: {
                          email: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          image: {
                            type: "image",
                            opt: false,
                          },
                          name: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          phoneNumber: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          position: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                          title: {
                            type: "string",
                            options: {},
                            opt: false,
                            raw: false,
                          },
                        },
                        opt: false,
                      },
                      opt: false,
                    },
                    opt: false,
                    values: "number",
                  },
                  details: {
                    type: "array",
                    item: {
                      type: "object",
                      items: {
                        title: {
                          type: "string",
                          options: {},
                          opt: false,
                          raw: false,
                        },
                        text: {
                          type: "richtext",
                          opt: false,
                          options: {
                            style: {
                              bold: true,
                              italic: true,
                              lineThrough: true,
                            },
                            block: {
                              h1: true,
                              h2: true,
                              h3: true,
                              h4: true,
                              h5: true,
                              h6: true,
                              ul: true,
                              ol: true,
                            },
                            inline: {
                              a: true,
                              img: true,
                            },
                          },
                        },
                        button: {
                          type: "object",
                          items: {
                            text: {
                              type: "string",
                              options: {},
                              opt: false,
                              raw: false,
                            },
                            type: {
                              type: "union",
                              key: {
                                type: "literal",
                                value: "primary",
                                opt: false,
                              },
                              items: [
                                {
                                  type: "literal",
                                  value: "secondary",
                                  opt: false,
                                },
                              ],
                              opt: false,
                            },
                            url: {
                              type: "string",
                              options: {},
                              opt: false,
                              raw: false,
                            },
                          },
                          opt: true,
                        },
                      },
                      opt: false,
                    },
                    opt: false,
                  },
                  image: {
                    type: "image",
                    opt: true,
                  },
                  section: {
                    type: "keyOf",
                    path: "/content/benefits.val.ts",
                    schema: {
                      type: "array",
                      item: {
                        type: "object",
                        items: {
                          image: {
                            type: "image",
                            opt: true,
                          },
                          text: {
                            type: "richtext",
                            opt: true,
                            options: {
                              style: {
                                bold: true,
                                italic: true,
                                lineThrough: true,
                              },
                              block: {
                                h1: true,
                                h2: true,
                                h3: true,
                                h4: true,
                                h5: true,
                                h6: true,
                                ul: true,
                                ol: true,
                              },
                              inline: {
                                a: true,
                                img: true,
                              },
                            },
                          },
                          title: {
                            type: "string",
                            options: {},
                            opt: true,
                            raw: false,
                          },
                        },
                        opt: false,
                      },
                      opt: false,
                    },
                    opt: false,
                    values: "number",
                  },
                  theme: {
                    type: "union",
                    key: {
                      type: "literal",
                      value: "light",
                      opt: false,
                    },
                    items: [
                      {
                        type: "literal",
                        value: "dark",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "alternatingStartLight",
                        opt: false,
                      },
                      {
                        type: "literal",
                        value: "alternatingStartDark",
                        opt: false,
                      },
                    ],
                    opt: false,
                  },
                },
                opt: false,
              },
              opt: false,
            },
            opt: false,
            values: "string",
          },
          description: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          order: {
            type: "number",
            opt: true,
          },
          active: {
            type: "boolean",
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/employees/contactEmployees.val.ts": {
    source: [
      {
        email: "mkd@blank.no",
        image: {
          _ref: "/public/images/257b08da97da1605eec4df9f8a974efc754bcc33-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "77bf4a9af0d1d42487dcd2c5770d60a0fa77fcfff6d554c160801fda24b96d63",
            mimeType: "image/webp",
          },
        },
        name: "Magne Davidsen",
        phoneNumber: "40221672",
        position: "Leder for teknologi",
        title: "Spør Magne om alt du lurer på om teknologi i Blank",
      },
      {
        email: "jbo@blank.no",
        image: {
          _ref: "/public/images/2417d8a92ffb7b02b2301e40c46779376b484c19-268x176.webp",
          _type: "file",
          metadata: {
            width: 268,
            height: 176,
            sha256:
              "4cab4e819c2edb0b72525edf6025a7588e33112122dde55b34751225b81db34f",
            mimeType: "image/webp",
          },
        },
        name: "Jon Bernholdt Olsen",
        phoneNumber: "98219371",
        position: "Leder for design",
        title: "Spør Jon om alt du lurer på om design i blank",
      },
      {
        email: "clara@blank.no",
        image: {
          _ref: "/public/images/c1cc2765dae6485e9f45e810de41cef61d2307de-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "afd5fe5a8175187983bc89288d0fd3fd713af8061b68c0d582ac6b67a27c31da",
            mimeType: "image/webp",
          },
        },
        name: "Clara Patek",
        phoneNumber: "46116241",
        position: "Teknolog",
        title: "Spør Clara om alt du lurer på om stillingen",
      },
      {
        email: "lig@blank.no",
        image: {
          _ref: "/public/dscf6732_47393.jpg",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "47393224de49c88668ec05bf3107fd4bea702ec74c855dfb39749444a209fa5c",
            hotspot: {
              x: 0.1320754716981132,
              y: 0.5377358490566038,
              width: 1,
              height: 1,
            },
            mimeType: "image/jpeg",
          },
        },
        name: "Lars-Ive Gjærder",
        phoneNumber: "928 95 785",
        position: "Designer",
        title:
          "Spør Lars-Ive om alt du lurer på om stilingen som nyutdannet designer",
      },
      {
        email: "clara@blank.no",
        image: {
          _ref: "/public/images/c1cc2765dae6485e9f45e810de41cef61d2307de-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "afd5fe5a8175187983bc89288d0fd3fd713af8061b68c0d582ac6b67a27c31da",
            mimeType: "image/webp",
          },
        },
        name: "Clara Patek",
        phoneNumber: "46116241",
        position: "Teknolog",
        title: "Spør Clara om alt du lurer på om stillingen",
      },
    ],
    schema: {
      type: "array",
      item: {
        type: "object",
        items: {
          email: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          image: {
            type: "image",
            opt: false,
          },
          name: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          phoneNumber: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          position: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          title: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
  "/content/employees/employeeList.val.ts": {
    source: {
      mkd: {
        email: "mkd@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/257b08da97da1605eec4df9f8a974efc754bcc33-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "77bf4a9af0d1d42487dcd2c5770d60a0fa77fcfff6d554c160801fda24b96d63",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6729559748427673,
              y: 0.21242895983706975,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Magne Davidsen",
        phoneNumber: "402 21 672",
        position: "Leder Teknologi",
      },
      eå: {
        email: "ea@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/f21ec6495fbc8b503abb245866dbe642d09a2639-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "fd9789108656fae06245cf417f04259005de4073e70ce6d06157b217e366c663",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5,
              y: 0.50011795954819,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Erlend Åmdal",
        phoneNumber: "456 98 346",
        position: "Teknolog",
      },
      svg: {
        email: "svg@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/ee6f57aeb610bd666691d1fc034348fdb3f46d79-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "f2a18af3a182c97431117c94b02a584489ef4f19062764b94af9d48696f4c581",
            mimeType: "image/webp",
            hotspot: {
              x: 0.4528301886792453,
              y: 0.4953998655901883,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Simen Viken Grini",
        phoneNumber: "452 07 148",
        position: "Teknolog",
      },
      tø: {
        email: "to@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/669f505e998be65f8e9d0f53de9d3b3d69bce4d5-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "009654164c6581e9a48c94eb9eed229807078fa4cf6dfbf7cde9203b1da020b7",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5251572327044025,
              y: 0.39631989247215066,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Trond Øydna",
        phoneNumber: "975 22 417",
        position: "Teknolog",
      },
      fe: {
        email: "fe@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/c9d288c876499697bbf0740ba2a395acbd762cb1-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "d6cc01726a28bc692de9cd26c17fe1c5b05e1e1f790d10e0020099dbecad2a58",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5251572327044025,
              y: 0.3680113287241399,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Fredrik Ekholdt",
        phoneNumber: "99000705",
        position: "Teknolog",
      },
      agm: {
        email: "anders.moe@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/7b420177d39890feb1f3a5ca9e40df7cfd4a8603-6000x4000.webp",
          _type: "file",
          metadata: {
            width: 6000,
            height: 4000,
            sha256:
              "139131234227d9b0cd89523ea21cab0e20ba219bcb7c121b3001ce17659a00b2",
            mimeType: "image/webp",
            hotspot: {
              x: 0.4716981132075472,
              y: 0.41509433962264153,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Anders Grotthing Moe",
        phoneNumber: "971 04 781",
        position: "Teknolog",
      },
      tt: {
        email: "thea.togstad@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/b7d07825ddb6f282f58babe5f25a888ccb58d69c-1600x1067.webp",
          _type: "file",
          metadata: {
            width: 1600,
            height: 1067,
            sha256:
              "66630edf7816f5b48b28e275e79a9fb6e0aeb444366b4a88931cf50bbc4481f9",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6037735849056604,
              y: 0.29707639249702167,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Thea Togstad",
        phoneNumber: "98833096",
        position: "Designer",
      },
      zi: {
        email: "zaim.imran@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/9e19025836290b3cf37fae16a00aaf1d3ffbcc57-4724x3149.webp",
          _type: "file",
          metadata: {
            width: 4724,
            height: 3149,
            sha256:
              "0b248197b93f91e22bcf743dd9fcbab3f2a065e9cd8ce2c9c41340d60f4e0ae9",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5,
              y: 0.44343107883799504,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Zaim Imran",
        phoneNumber: "401 70 752",
        position: "Teknolog",
      },
      sk: {
        email: "sandra.kofoed@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/72b87df8f0f319021a96eb524bd3ca279d387f39-2000x1333.webp",
          _type: "file",
          metadata: {
            width: 2000,
            height: 1333,
            sha256:
              "66c2a34553fcd2218f94150d1613b307ddab1a641030fbc2bb503a9af0519f4d",
            mimeType: "image/webp",
            hotspot: {
              x: 0.559748427672956,
              y: 0.39160179851414884,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Sandra Kofoed",
        phoneNumber: "90899996",
        position: "Designer",
      },
      mr: {
        email: "mats.rosbach@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/5ca04afac61f95c21cb505f8fc755725a432c2d9-2000x1333.webp",
          _type: "file",
          metadata: {
            width: 2000,
            height: 1333,
            sha256:
              "f3987c966c5f207723f4a9872ae8f4b1eead8f7c42386140f7405c4f6b9731b2",
            mimeType: "image/webp",
            hotspot: {
              x: 0.39622641509433965,
              y: 0.27459312594962476,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Mats Rosbach",
        phoneNumber: "91348632",
        position: "Teknolog",
      },
      ae: {
        email: "astri.eiterstraum@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/5a535699eed4a99550c696f048f5af3a51548f82-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "36650ad73499ba118ee7adcaf03f583daa3af1edad15c42f146e5231c7f4aedf",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5723270440251572,
              y: 0.2830188679245283,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Astri Eiterstraum",
        phoneNumber: "942 94 902",
        position: "Designer",
      },
      jl: {
        email: "johan.lindkvist@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/f744ad8c83ca57922e21098616d50a3b38c2da05-1365x1599.webp",
          _type: "file",
          metadata: {
            width: 1365,
            height: 1599,
            sha256:
              "c5276faac839581744edd8d4f3d9edfd30453513583bf8c1fb71401c71d8b084",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5157232704402516,
              y: 0.36239989658075866,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Johan Lindkvist",
        phoneNumber: "471 33 175",
        position: "Teknolog",
      },
      lls: {
        email: "ls@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/d5cd6f641a93797a346f495fc8d9df4726f7ed44-1638x2048.webp",
          _type: "file",
          metadata: {
            width: 1638,
            height: 2048,
            sha256:
              "2fade21801c55554ec9cf23ed6004c1c093517fcc5c50bdbfe2d633baf9dd8c4",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5345911949685535,
              y: 0.35462776115574424,
              width: 1,
              height: 1,
            },
          },
        },
        name: " Lars fra Bøler",
        phoneNumber: "480 77 580",
        position: "Teknolog",
      },
      sys: {
        email: "soo.yeong.song@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/e7557f430300395702c3a7e9583a332657ee8f04-1638x1413.webp",
          _type: "file",
          metadata: {
            width: 1638,
            height: 1413,
            sha256:
              "4314c22e27829c44874ddc0cc30fa0d61ac05b057dc5525b6551334d131849ce",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5408805031446541,
              y: 0.2770520852153033,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Soo Yeong Song",
        phoneNumber: "973 18 259",
        position: "Designer",
      },
      lo: {
        email: "lisa@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/d3e5f3c321405a477354f5c1e07b4e0910ac778d-1412x1465.webp",
          _type: "file",
          metadata: {
            width: 1412,
            height: 1465,
            sha256:
              "bf53c1cf4c3a875fa7ad1f6852dc7279aeb58ae3289c0ff9f2d58fe070da2a86",
            mimeType: "image/webp",
            hotspot: {
              x: 0.4811320754716981,
              y: 0.35461707686877453,
              width: 1,
              height: 1,
            },
          },
        },
        name: " Lisa Ottesen",
        phoneNumber: "482 12 169",
        position: "Teknolog",
      },
      mwb: {
        email: "maria.brandt@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/551785bbca61d69378cb93f7e743a29ff6f098ad-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "c64ee2aa5ef62925aa99b6035ef582cc2d61419b58bfac105d012c5047089cd5",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5220125786163522,
              y: 0.3491389528921327,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Maria Wang Brandt",
        phoneNumber: "475 02 020",
        position: "Designer",
      },
      johnk: {
        email: "jk@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/f783df883f311b54850491cd780e1ce2518b01d1-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "0d019cad92b438b276331675881caa821e10a5bbb426e777d4e417e973345ede",
            mimeType: "image/webp",
            hotspot: {
              x: 0.39937106918238996,
              y: 0.2068387240518837,
              width: 1,
              height: 1,
            },
          },
        },
        name: "John Korsnes",
        phoneNumber: "95939807",
        position: "Teknolog",
      },
      '"Han som knekker fisk"': {
        email: "lars@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/db85f8949a0b554eab1bdb0c878fd9a783c952a5-1613x1292.webp",
          _type: "file",
          metadata: {
            width: 1613,
            height: 1292,
            sha256:
              "5b3b020c7c65d21b722f1961aaf247ed46ad5ecd26321748db656c928cac9437",
            mimeType: "image/webp",
            hotspot: {
              x: 0.42452830188679247,
              y: 0.28266702354042933,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Lars Smeby",
        phoneNumber: "412 10 297",
        position: "Teknolog",
      },
      lee: {
        email: "lf@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/31178284fa78d1cb85b5f2d1474a9908bb438296-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "94fccb9f6e282c109e0a8d62a6b595ab7a0c21111dc5b53f66678df08218d2c9",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5062893081761006,
              y: 0.4293465501781632,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Lee Frost",
        phoneNumber: "45813884",
        position: "Fagsjef Design",
      },
      øj: {
        email: "oyvind.johannessen@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/e9a3d84c0360b7e1356340c3babbd7d22a6723e2-2048x1638.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1638,
            sha256:
              "c56d164eec52cde6351de8157131e861935d51343ad2ae3ddf73ea7dbf3901b2",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5220125786163522,
              y: 0.37352556448171403,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Øyvind Johannessen",
        phoneNumber: "930 04 362",
        position: "Designer",
      },
      ag: {
        email: "adam.gaidi@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/7cc5303b9d04f53d94ff66bb4f5e122d91816e51-1600x1446.webp",
          _type: "file",
          metadata: {
            width: 1600,
            height: 1446,
            sha256:
              "b5bf67682f039e7df6ffa06dd1e9d1123eeca993052504a47489a54e6a4bc163",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5345911949685535,
              y: 0.3375087058454755,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Adam Gaidi",
        phoneNumber: "979 55 474",
        position: "Teknolog",
      },
      iem: {
        email: "im@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/e1efd5308e797400d78d76637f77896b30440386-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "bfda7690a9d618e1de93ab8de0dd968312233ae57faba77be17397abc7b257d6",
            mimeType: "image/webp",
            hotspot: {
              x: 0.37735849056603776,
              y: 0.4360305812176448,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Ingrid Elisabeth Moen",
        phoneNumber: "988 49 544",
        position: "Teknolog",
      },
      tu: {
        email: "tu@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/fbc3f3462689785d54763ddd2bd47f32270239ca-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "c009e160a6e7979010be0fe26fbf59dbce31f9b737beacb3aea136ac2d50d842",
            mimeType: "image/webp",
            hotspot: {
              x: 0.4968553459119497,
              y: 0.39160179851414884,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Terje Uglebakken",
        phoneNumber: "918 60 882",
        position: "Teknolog",
      },
      yj: {
        email: "yj@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/7052551e53495fc8219ccea699f51c1c52be5ffb-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "3e0ba18abe33db75ef9e08f58aadb76c9994b47e9b385e2cb5126d4d6f4b58dd",
            mimeType: "image/webp",
            hotspot: {
              x: 0.449685534591195,
              y: 0.5310723995926744,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Yngvar Johnsen",
        phoneNumber: "909 68 606",
        position: "Teknolog",
      },
      clara: {
        email: "clara@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/c1cc2765dae6485e9f45e810de41cef61d2307de-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "afd5fe5a8175187983bc89288d0fd3fd713af8061b68c0d582ac6b67a27c31da",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6163522012578616,
              y: 0.5095541474641937,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Clara Patek",
        phoneNumber: "46116241",
        position: "Teknolog",
      },
      cs: {
        email: "cornelia.schmitt@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/1c7c27ba18e876f5429915c1a40fe75eed99c879-2000x1333.webp",
          _type: "file",
          metadata: {
            width: 2000,
            height: 1333,
            sha256:
              "f9ba6ee3ffff9f166578d7a6e8762a176eba61eab7c5a6696ca2df38c49d0f1d",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6415094339622641,
              y: 0.3774475166401435,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Cornelia Schmitt",
        phoneNumber: "988 62 571",
        position: "Designer",
      },
      vh: {
        email: "vilde.hurum@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/c597d6ba508cffee14465b586a530359495c0d94-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "46cc979c26fb5768793fcd7e3db5e1d371a9b2a4b1d97ed3d0d68908f75327aa",
            mimeType: "image/webp",
            hotspot: {
              x: 0.3081761006289308,
              y: 0.330188679245283,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Vilde Innset Hurum",
        phoneNumber: "91894462",
        position: "Teknolog",
      },
      tp: {
        email: "tina.pande@blank.no ",
        contactPerson: false,
        image: {
          _ref: "/public/images/deaf86d4196df72a864808244ba4c4d33c831295-1600x1067.webp",
          _type: "file",
          metadata: {
            width: 1600,
            height: 1067,
            sha256:
              "546229e05a517e376d0c728cd0c72391b19a978c85706030933845fefa55cc45",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5314465408805031,
              y: 0.21691292150576189,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Tina Pande",
        phoneNumber: "984 24 985",
        position: "Office manager",
      },
      un: {
        email: "une@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/091254514dc409ed00927cca7e34120b5988236c-599x676.webp",
          _type: "file",
          metadata: {
            width: 599,
            height: 676,
            sha256:
              "7a390313b96934160720914b2269aca5076af1222206578925eec46e97688a82",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5157232704402516,
              y: 0.3650211324273554,
              width: 1,
              height: 1,
            },
          },
        },
        name: " Une Nordli",
        phoneNumber: "916 25 863",
        position: "Designer",
      },
      ajj: {
        email: "andreas.jonassen@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/2357646222a4f3710918e6501cde60a238e1c1dd-2000x1333.webp",
          _type: "file",
          metadata: {
            width: 2000,
            height: 1333,
            sha256:
              "00919d628cae20b155ecb834f8789e39d5f36a139e307459e82ad2b4861df893",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6257861635220126,
              y: 0.4010379864301524,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Andreas Jensen Jonassen",
        phoneNumber: "41340095",
        position: "Teknolog",
      },
      TBN: {
        email: "thea.nilsen@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/1de07ab7ef0f72004c25f08c080cf256424c6919-1200x800.webp",
          _type: "file",
          metadata: {
            width: 1200,
            height: 800,
            sha256:
              "f7c83c50801882182a121d6156a5b00dae01b1a3cdcc09f5bbc05060d0f02b4a",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6761006289308176,
              y: 0.3915094339622642,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Thea Basthus Nilsen",
        phoneNumber: "90890497",
        position: "Designer",
      },
      oj: {
        email: "oj@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/31a882fc37b4b41ec608476778d58e2160609b4f-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "9f7078bbbe6efaca2dd4f8e35b24d9645d42ccce56bc107c981f849e60be17eb",
            mimeType: "image/webp",
            hotspot: {
              x: 0.2830188679245283,
              y: 0.19006801669632556,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Ole Jacob Eriksen Syrdahl",
        phoneNumber: "959 39 804",
        position: "Fagsjef Teknologi",
      },
      anja: {
        email: "anja@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/efdf50b4b096773ee71d33e3d2bbec7a2e5c5d28-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "d350811a15c1c3b4f7ec0927b686b5679cb7a3497d4f88aee857c7ec551a8369",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5817610062893082,
              y: 0.44350083205216856,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Anja Stedjeberg Hansen",
        phoneNumber: "48069352",
        position: "Designer",
      },
      mn: {
        email: "mn@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/c1afac67605b25890fcdd1ccb67216c606b40a4e-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "dcca5a819c79df1271f40cae18dfa90e06042725648174ef2a6fa239981738b1",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6352201257861635,
              y: 0.44162862702969763,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Mads Nyborg",
        phoneNumber: "959 39 813",
        position: "Teknolog",
      },
      mb: {
        email: "mb@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/28750e8632d2234fec634af2798553d2285f5f73-2048x1638.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1638,
            sha256:
              "1769647ec8d279136040c3ec4ee02e0c21f08e16c971339bbc4356f0615f7930",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5251572327044025,
              y: 0.3853211086232418,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Martin Bøckman",
        phoneNumber: "476 05 914",
        position: "Designer",
      },
      kmb: {
        email: "kb@blank.no",
        contactPerson: true,
        image: {
          _ref: "/public/images/5fbf7dc4e3c452145eee0e9ae2c8f08cf683b826-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "46bb7bb60ca03f6224bb42e3f5458e136b731e032bbff460feaf7dd7bd307019",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5817610062893082,
              y: 0.23618746192411044,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Knut Magnus Backer",
        phoneNumber: "99797799",
        position: "Salgssjef",
      },
      jaj: {
        email: "jaj@blank.no",
        contactPerson: true,
        image: {
          _ref: "/public/images/be7ab13650e8df26b6d6a47a0432b590d380cc56-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "f74b41f8998100228b921f498167e3d4ffa0e81b44fc5fa3ad697aa246fe295e",
            mimeType: "image/webp",
            hotspot: {
              x: 0.39622641509433965,
              y: 0.37715461980067383,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Jahn Arne Johnsen",
        phoneNumber: "98219394",
        position: "Daglig Leder",
      },
      kmh: {
        email: "kevin@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/e90ab5b7eaaa8df05511cbe40b26bde8a6a17856-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "2ee2131b43df79676a2a4d940a703d3bc29d4157668c3c2449d069b13545dda0",
            mimeType: "image/webp",
            hotspot: {
              x: 0.6037735849056604,
              y: 0.3443396226415094,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Kevin Mentzoni Halvarsson",
        phoneNumber: "47449912",
        position: "Teknolog",
      },
      nlr: {
        email: "neva.rustad@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/06368c63f9e95a1c40c7b8895ff845c847965766-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "51abc887edf348f462230f1dd95918f503f6cbd5f99a65df09b4de60987690c7",
            mimeType: "image/webp",
            hotspot: {
              x: 0.4968553459119497,
              y: 0.24056603773584906,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Neva Linn Rustad",
        phoneNumber: "934 94 521",
        position: "Designer",
      },
      jbo: {
        email: "jbo@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/d377a8bb10de3e189a5fa30004393e735a807b61-800x450.webp",
          _type: "file",
          metadata: {
            width: 800,
            height: 450,
            sha256:
              "194bc9c5bea58d7357280419954b42974b9c41f069e594578b0d7c763678d133",
            mimeType: "image/webp",
            hotspot: {
              x: 0.7264150943396226,
              y: 0.2627410819037442,
              width: 1,
              height: 1,
            },
          },
        },
        name: " Jon Bernholdt  Olsen",
        phoneNumber: "982 19 371",
        position: "Leder Design",
      },
      lig: {
        email: "lig@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/d1b87c263fac4e67a37410cddbea9015cbbcad22-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "e5068acd608cfc56d7c965fee04721b910383832ec78e31ee3026366743ace7a",
            mimeType: "image/webp",
            hotspot: {
              x: 0.39622641509433965,
              y: 0.3113207547169811,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Lars-Ive Gjærder",
        phoneNumber: "92895785",
        position: "Designer",
      },
      as: {
        email: "as@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/7c89c6f3ebd247e3652e5fa3c19a5d5baf787a5a-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "c84a3fa62242c1ae7ef91451daacb6360808fb31bdf899d0217257aca5b129d6",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5,
              y: 0.4151922683041578,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Andreas Rudi Søvik",
        phoneNumber: "48103122",
        position: "Teknolog",
      },
      isak: {
        email: "isak.bjornstad@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/ff85db6372ed3f552b4460a57cc00c0daa21bdc2-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "d70b6e86dd2ec160fe03d9899c68e6cf96f809d0a7b2799067eba327316cae0b",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5,
              y: 0.2783675435221058,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Isak Grande Bjørnstad",
        phoneNumber: "94425952",
        position: "Teknolog",
      },
      km: {
        email: "kim@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/1ea93de6a9d0375fddca73d10222a2a716d66a70-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "9a2af714eced63307a893614758218bcd706a8bafdff4c0c808966829639db70",
            mimeType: "image/webp",
            hotspot: {
              x: 0.14779874213836477,
              y: 0.330188679245283,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Kim Midtlid",
        phoneNumber: "48607010",
        position: "Teknolog",
      },
      pjb: {
        email: "petter.barhaugen@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/61437667149b696faae6e87ce5308c733844dc2d-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "acf59ed93674e31e6d08acfc8231003660929e198709ed88f1128994123f859c",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5911949685534591,
              y: 0.330188679245283,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Petter Juterud Barhaugen",
        phoneNumber: "469 60 023",
        position: "Teknolog",
      },
      mth: {
        email: "mathilde.hegdal@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/a08597ec16ddf0d67819cbb3ca06487e9a62d050-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "dad3ea100b6793be410bc561c33146578359215aecdaeee343171f37cb8944e7",
            mimeType: "image/webp",
            hotspot: {
              x: 0.8207547169811321,
              y: 0.24056603773584906,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Mathilde Tillman Hegdal",
        phoneNumber: "476 29 273",
        position: "Teknolog",
      },
      emilie: {
        email: "emilie.maehlum@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/f1330715e82148e6d418cfa64260aacfef4cd575-2048x1365.webp",
          _type: "file",
          metadata: {
            width: 2048,
            height: 1365,
            sha256:
              "3b60da44914b3cff16654fb7c87b87b1fde37b4d86b1fb1f89cd77fb2c1d5d48",
            hotspot: {
              x: 0.6193548387096774,
              y: 0.609846479618846,
              width: 1,
              height: 1,
            },
            mimeType: "image/webp",
          },
        },
        name: "Emilie Mæhlum",
        phoneNumber: "99303615",
        position: "Teknolog",
      },
      bs: {
        email: "bendik@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/cf77ea703db7ec8b92d3474ba0e99e5c20325510-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "36fa7fd782c2fd9bdd612a4988002c42ef47dedd2a57de1934686d306f624acb",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5880503144654088,
              y: 0.3160377358490566,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Bendik Schrøder",
        phoneNumber: "979 87 660",
        position: "Designer",
      },
      mts: {
        email: "pepsi-max@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/0300c54992399710f6e63f43e06450a58fa90af9-6240x4160.webp",
          _type: "file",
          metadata: {
            width: 6240,
            height: 4160,
            sha256:
              "a77551d9e735d6f20c21555ddfb373fbbb07ba620fa1e8201e761ca0ed7ba2e5",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5628930817610063,
              y: 0.35377358490566035,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Max Torre Schau",
        phoneNumber: "917 82 159",
        position: "Teknolog",
      },
      tar: {
        email: "tr@blank.no",
        contactPerson: false,
        image: {
          _ref: "/public/images/2139922f7bb8598b0df43f1460a8e79baa617ec7-2000x1333.webp",
          _type: "file",
          metadata: {
            width: 2000,
            height: 1333,
            sha256:
              "feaf465b6bdd20d8241913a6d2d45ca59de4ca291401f53076076a4e5130dd48",
            mimeType: "image/webp",
            hotspot: {
              x: 0.5786163522012578,
              y: 0.24534088581609326,
              width: 1,
              height: 1,
            },
          },
        },
        name: "Thomas A. Ramirez",
        phoneNumber: "40097705",
        position: "Teknolog",
      },
      jlg: {
        name: "Jonas Grimstad Lierstuen",
        email: "jonas.lierstuen@blank.no",
        image: {
          _ref: "/public/blank_3d5d2.png",
          _type: "file",
          metadata: {
            width: 2487,
            height: 2204,
            sha256:
              "3d5d28fc23869e088a579367ba3d525f54f2e56a9d727f9cfefd6f9a4a924800",
            mimeType: "image/png",
          },
        },
        position: "Teknolog",
        phoneNumber: "",
        contactPerson: false,
      },
      nd: {
        name: "Nevena Dokic",
        email: "nevena.dokic@blank.no",
        image: {
          _ref: "/public/blank_3d5d2.png",
          _type: "file",
          metadata: {
            width: 2487,
            height: 2204,
            sha256:
              "3d5d28fc23869e088a579367ba3d525f54f2e56a9d727f9cfefd6f9a4a924800",
            mimeType: "image/png",
          },
        },
        position: "Designer",
        phoneNumber: "",
        contactPerson: false,
      },
    },
    schema: {
      type: "record",
      item: {
        type: "object",
        items: {
          email: {
            type: "string",
            options: {},
            opt: false,
            raw: true,
          },
          image: {
            type: "image",
            opt: false,
          },
          name: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          phoneNumber: {
            type: "string",
            options: {},
            opt: false,
            raw: false,
          },
          contactPerson: {
            type: "boolean",
            opt: false,
          },
          position: {
            type: "union",
            key: {
              type: "literal",
              value: "Daglig Leder",
              opt: false,
            },
            items: [
              {
                type: "literal",
                value: "Salgssjef",
                opt: false,
              },
              {
                type: "literal",
                value: "Teknolog",
                opt: false,
              },
              {
                type: "literal",
                value: "Leder Teknologi",
                opt: false,
              },
              {
                type: "literal",
                value: "Fagsjef Teknologi",
                opt: false,
              },
              {
                type: "literal",
                value: "Designer",
                opt: false,
              },
              {
                type: "literal",
                value: "Leder Design",
                opt: false,
              },
              {
                type: "literal",
                value: "Fagsjef Design",
                opt: false,
              },
              {
                type: "literal",
                value: "Office manager",
                opt: false,
              },
            ],
            opt: false,
          },
        },
        opt: false,
      },
      opt: false,
    },
  },
} as any).catch(console.error);

export function splitModulePath(input: ModulePath) {
  const result: string[] = [];
  let i = 0;

  while (i < input.length) {
    let part = "";

    if (input[i] === '"') {
      // Parse a quoted string
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && input[i + 1] === '"') {
          // Handle escaped double quotes
          part += '"';
          i++;
        } else {
          part += input[i];
        }
        i++;
      }
      if (input[i] !== '"') {
        throw new Error(
          `Invalid input (${JSON.stringify(
            input,
          )}): Missing closing double quote: ${
            input[i] ?? "at end of string"
          } (char: ${i}; length: ${input.length})`,
        );
      }
    } else {
      // Parse a regular string
      while (i < input.length && input[i] !== ".") {
        part += input[i];
        i++;
      }
    }

    if (part !== "") {
      result.push(part);
    }

    i++;
  }

  return result;
}
