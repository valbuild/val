import { FC } from "react";

const ExpandLogo: FC<{ expanded: boolean; className?: string }> = ({
  expanded,
  className,
}) => {
  return (
    <div>
      {expanded ? (
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          xmlns="http://www.w3.org/2000/svg"
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0.606061 9.39394V6.25H0V10H3.75V9.39394H0.606061Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.4319 0.644146L9.4319 3.78809L10.038 3.78809L10.038 0.0380859L6.28796 0.0380863L6.28796 0.644146L9.4319 0.644146Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.11371e-05 9.59583L3.34602 6.24995L3.78796 6.6919L0.441965 10.0378L3.11371e-05 9.59583Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.0379 0.441766L6.69194 3.78764L6.25001 3.3457L9.596 -0.000183055L10.0379 0.441766Z"
          />
        </svg>
      ) : (
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={className}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.14394 6.85606L3.14394 10L3.75 10L3.75 6.25L-3.27835e-07 6.25L-2.74852e-07 6.85606L3.14394 6.85606Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M6.89402 3.18203V0.0380859L6.28796 0.0380859L6.28796 3.78809L10.038 3.78809V3.18203L6.89402 3.18203Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.11371e-05 9.59583L3.34602 6.24995L3.78796 6.6919L0.441965 10.0378L3.11371e-05 9.59583Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.0379 0.441766L6.69194 3.78764L6.25001 3.3457L9.596 -0.000183055L10.0379 0.441766Z"
          />
        </svg>
      )}
    </div>
  );
};
export default ExpandLogo;
