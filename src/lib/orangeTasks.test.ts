import { expect, it } from "vitest";
import { ORANGE_TASK_KEYS, canCheckIn, isOrangeTask } from "./orangeTasks";
it("permits only the five requested tasks",()=>{expect([...ORANGE_TASK_KEYS]).toEqual(["daily_checkin","join_channel","follow_x","buy_orange","first_subscription"]);expect(isOrangeTask("first_chat")).toBe(false);expect(isOrangeTask("invite_friend")).toBe(false)});
it("daily check-in requires 24 hours",()=>{const at="2026-10-23T00:00:00Z";expect(canCheckIn(at,Date.parse(at)+24*3600_000-1)).toBe(false);expect(canCheckIn(at,Date.parse(at)+24*3600_000)).toBe(true)});