import { FC } from "react";

const Chevron: FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.70733 1.00015L8.7784 6.07121L8.07129 6.77832L3.00022 1.70725L3.70733 1.00015Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.00015 10.4709L8.07121 5.39983L8.77832 6.10693L3.70725 11.178L3.00015 10.4709Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default Chevron;
