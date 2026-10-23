/** @doc Brand helper — always returns "Nova" and brandText is a passthrough. */
export function getZoneBrand(): "Nova" {
  return "Nova";
}

/** Passthrough — no rebrand needed. */
export function brandText<T>(value: T, _brand: string = "Nova"): T {
  return value;
}
