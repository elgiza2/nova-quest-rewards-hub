/** @doc useBrandLogo — returns the Orange brand icon URL (Orange AI logo). */
import orangeLogo from "@/assets/orange-logo.png.asset.json";

const orangeIconUrl = orangeLogo.url;

export function useBrandLogo(): string {
  return orangeIconUrl;
}

export { orangeIconUrl as megsyIcon, orangeIconUrl as orangeIcon };
