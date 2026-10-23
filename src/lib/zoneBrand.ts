/** @doc Brand helper — always returns "Orange" and brandText is a passthrough. */
export function getZoneBrand(): "Orange" {
  return "Orange";
}

/** Passthrough — no rebrand needed. */
export function brandText<T>(value: T, _brand: string = "Orange"): T {
  return value;
}
