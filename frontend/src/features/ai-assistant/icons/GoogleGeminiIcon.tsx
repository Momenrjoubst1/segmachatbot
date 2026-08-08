import type { SVGProps } from "react";

export const GoogleGeminiIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M12 24C12 24 12 17.25 17.25 12C12 6.75 12 0 12 0C12 0 12 6.75 6.75 12C12 17.25 12 24 12 24Z"
      fill="url(#paint0_radial_3172_13764)"
    />
    <defs>
      <radialGradient
        id="paint0_radial_3172_13764"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform="translate(12 12) rotate(90) scale(12)"
      >
        <stop stopColor="#4285F4" />
        <stop offset="0.34375" stopColor="#9B72CB" />
        <stop offset="0.635417" stopColor="#D96570" />
        <stop offset="0.854167" stopColor="#F4AF83" />
        <stop offset="1" stopColor="#F2A65E" />
      </radialGradient>
    </defs>
  </svg>
);
