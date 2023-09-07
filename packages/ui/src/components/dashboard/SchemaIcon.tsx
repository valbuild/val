import { SerializedSchema } from "@valbuild/core";

export function SchemaIcon({
  type,
}: {
  type: SerializedSchema["type"] | "module";
}): React.ReactElement {
  switch (type) {
    case "array":
      return <ArrayIcon />;
    case "module":
      return <span>📦</span>;
    case "object":
      return <span>📁</span>;
    case "boolean":
      return <span>🔘</span>;
    case "i18n":
      return <span>🌐</span>;
    case "image":
      return <span>🖼</span>;
    case "literal":
      return <span>🔤</span>;
    case "number":
      return <span>🔢</span>;
    case "string":
      return <TextIcon />;
    case "richtext":
      return <span>📝</span>;
    case "oneOf":
      // reference:
      return <span>🔗</span>;
    case "union":
      // venn diagram
      return <span>🔗</span>;

    default:
      throw new Error("Unknown type: " + type);
  }
}

function ArrayIcon() {
  return (
    <svg
      width="9"
      height="10"
      viewBox="0 0 9 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_1394_4248)">
        <rect
          width="9"
          height="9"
          transform="translate(0 0.5)"
          fill="#1A1A1A"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9 1.5H0V0.5H9V1.5Z"
          fill="#FCFCFC"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9 9.5H0V8.5H9V9.5Z"
          fill="#FCFCFC"
        />
      </g>
      <defs>
        <clipPath id="clip0_1394_4248">
          <rect
            width="9"
            height="9"
            fill="white"
            transform="translate(0 0.5)"
          />
        </clipPath>
      </defs>
    </svg>
  );
}

function TextIcon() {
  return (
    <svg
      width="9"
      height="10"
      viewBox="0 0 9 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0.0145513 0.5H8.98545L9 3.18569H8.57074C8.43007 2.2276 8.02749 1.57948 7.36298 1.24133C6.98949 1.05491 6.43169 0.953035 5.68957 0.935694V7.94581C5.68957 8.43569 5.78416 8.76084 5.97332 8.92124C6.16734 9.08165 6.5675 9.16185 7.17381 9.16185V9.5H1.86257V9.16185C2.44462 9.16185 2.83023 9.08165 3.0194 8.92124C3.21342 8.7565 3.31043 8.43136 3.31043 7.94581V0.935694C2.58286 0.953035 2.02506 1.05491 1.63703 1.24133C0.92401 1.58815 0.521423 2.23627 0.429264 3.18569H0L0.0145513 0.5Z"
        fill="#FCFCFC"
      />
    </svg>
  );
}
