import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen tile on iOS: Tod's face from `icon.svg`, full bleed,
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
            d="M8.6 10.6l3.9 3.4-3.9 3.4"
            fill="none"
            stroke="#111111"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="21.6" cy="14" r="2.3" fill="#111111" />
          <path
            d="M12.9 21.4q3.1 2.3 6.2 0"
            fill="none"
            stroke="#111111"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
