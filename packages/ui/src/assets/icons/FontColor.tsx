import { FC } from "react";

const FontColor: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      width={25}
      height={25}
    >
      <g>
        <path d="M29,27H3c-0.6,0-1,0.4-1,1s0.4,1,1,1h26c0.6,0,1-0.4,1-1S29.6,27,29,27z" />
        <path
          d="M6.4,16.7C6.4,16.7,6.4,16.7,6.4,16.7l7,7c0.2,0.2,0.4,0.3,0.7,0.3s0.5-0.1,0.7-0.3l6.9-6.9c0,0,0,0,0,0l1.5-1.5
		c0.4-0.4,0.4-1,0-1.4l-8.9-9c0,0,0,0,0,0l-2.5-2.5c-0.4-0.4-1-0.4-1.4,0s-0.4,1,0,1.4l1.8,1.8l-7.7,7.7c-0.4,0.4-0.4,1,0,1.4
		L6.4,16.7z M13.6,7L14,7.5c0,0,0,0,0,0l7,7L20.6,15H7.5l-1-1L13.6,7z"
        />
        <path d="M25,24c1.7,0,3-1.3,3-3c0-1.4-1.8-3.2-2.3-3.7c-0.4-0.4-1-0.4-1.4,0C23.8,17.8,22,19.6,22,21C22,22.7,23.3,24,25,24z" />
      </g>
    </svg>
  );
};

export default FontColor;
