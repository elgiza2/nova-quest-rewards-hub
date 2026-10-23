export const ORANGE_TASK_KEYS = ["daily_checkin", "join_channel", "follow_x", "buy_orange", "first_subscription"] as const;
export function isOrangeTask(key: string): boolean { return ORANGE_TASK_KEYS.some(k => k === key); }
export function canCheckIn(completedAt: string | null, now = Date.now()): boolean { return !completedAt || now - Date.parse(completedAt) >= 24 * 3600_000; }