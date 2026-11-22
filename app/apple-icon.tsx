import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen tile on iOS: the prompt mark of `icon.svg`, full bleed,
 * because iOS rounds the corners itself and a rounded square inside its
 * rounded square reads as a border.
 */
export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff7a2e",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path
            d="M9 11l5 5-5 5"
            fill="none"
            stroke="#111111"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M17 21h6" stroke="#111111" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
