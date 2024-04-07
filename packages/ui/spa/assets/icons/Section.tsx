import { FC } from "react";

const Section: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      width="9"
      height="10"
      viewBox="0 0 9 10"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_1222_1618)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9 1.5H0V0.5H9V1.5Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9 9.5H0V8.5H9V9.5Z"
          fill="currentColor"
        />
      </g>
      <defs>
        <clipPath id="clip0_1222_1618">
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
};

export default Section;
