import { FC } from "react";

const Strikethrough: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1"
      className={className}
      width={12}
      height={12}
    >
      <path
        fillRule="evenodd"
        d="M13,15 L13,21 C13,21.5522847 12.5522847,22 12,22 C11.4477153,22 11,21.5522847 11,21 L11,15 L13,15 Z M3,13 C2.44771525,13 2,12.5522847 2,12 C2,11.4477153 2.44771525,11 3,11 L21,11 C21.5522847,11 22,11.4477153 22,12 C22,12.5522847 21.5522847,13 21,13 L3,13 Z M19,2 C19.5522847,2 20,2.44771525 20,3 C20,3.55228475 19.5522847,4 19,4 L13,4 L13,9 L11,9 L11,4 L5,4 C4.44771525,4 4,3.55228475 4,3 C4,2.44771525 4.44771525,2 5,2 L19,2 Z"
      />
    </svg>
  );
};

export default Strikethrough;
