/** @doc useBrandLogo — returns the Orange brand icon URL (Orange AI logo). */
const orangeLogo = { url: "/orange-logo.png" };

const orangeIconUrl = orangeLogo.url;

export function useBrandLogo(): string {
  return orangeIconUrl;
}

export { orangeIconUrl as megsyIcon, orangeIconUrl as orangeIcon };
