import { FC } from "react";

const ImageIcon: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={className}
      width={25}
      height={25}
      strokeWidth="4"
    >
      <g>
        <path d="M25,2H7A5,5,0,0,0,2,7V25a5,5,0,0,0,5,5H25a5,5,0,0,0,5-5V7A5,5,0,0,0,25,2ZM7,4H25a3,3,0,0,1,3,3v5.59l-1.88-1.88a3,3,0,0,0-4.24,0l-7.95,8-3-2.42a3,3,0,0,0-3.8,0L4,18.86V7A3,3,0,0,1,7,4ZM25,28H7a3,3,0,0,1-3-3V21.47l4.38-3.66a1,1,0,0,1,1.27,0l3.73,3a1,1,0,0,0,1.33-.07l8.58-8.59a1,1,0,0,1,1.42,0L28,15.41V25A3,3,0,0,1,25,28Z" />
        <path d="M10,13a3,3,0,1,0-3-3A3,3,0,0,0,10,13Zm0-4a1,1,0,1,1-1,1A1,1,0,0,1,10,9Z" />
      </g>
    </svg>
  );
};

export default ImageIcon;