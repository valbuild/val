import { FC } from "react";

const ImageIcon: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 9 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g clipPath="url(#clip0_1225_1638)">
        <rect y="0.5" width="9" height="9" />

        <path d="M0 7L8.5 5" stroke="currentColor" />
        <circle cx="3" cy="3.5" r="1" fill="currentColor" />
      </g>
      <rect x="0.5" y="1" width="8" height="8" stroke="currentColor" />
      <defs>
        <clipPath id="clip0_1225_1638">
          <rect y="0.5" width="9" height="9" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
};

export default ImageIcon;
