/** Browser Buffer polyfill — @ton/core's BOC serialization references the Node
 *  Buffer, so it must exist before that module initializes. Import this module
 *  BEFORE any @ton/core import. */
import { Buffer } from "buffer";

if (typeof globalThis !== "undefined" && typeof (globalThis as any).Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}
export {};
