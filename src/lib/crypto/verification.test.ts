import { describe, expect, it } from "vitest";
import { matchPaymentEvent, TON_USDT_MASTER } from "./verification";
const wallet = "0:" + "a".repeat(64);
const expected = {asset:"usdt_ton",wallet,amount:"19000000",memo:"OAI-user-random",createdAt:new Date(Date.now()-600_000).toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
const event = () => ({event_id:"b".repeat(64),timestamp:Math.floor((Date.now()-60_000)/1000),in_progress:false,is_scam:false,actions:[{type:"JettonTransfer",status:"ok",JettonTransfer:{recipient:{address:wallet},amount:"19000000",comment:expected.memo,jetton:{address:TON_USDT_MASTER}}}]});
describe("manual crypto verification",()=>{
 it("accepts exact recipient, USDT, amount and account reference",()=>expect(matchPaymentEvent(event(),expected)).toBe("b".repeat(64)));
 it("rejects a different recipient",()=>{const e=event(); e.actions[0].JettonTransfer.recipient.address="0:"+"c".repeat(64);expect(matchPaymentEvent(e,expected)).toBeNull()});
 it("rejects a missing reference",()=>{const e=event();e.actions[0].JettonTransfer.comment="";expect(matchPaymentEvent(e,expected)).toBeNull()});
 it("rejects a wrong amount",()=>{const e=event();e.actions[0].JettonTransfer.amount="19000001";expect(matchPaymentEvent(e,expected)).toBeNull()});
 it("rejects wrong token",()=>{const e=event();e.actions[0].JettonTransfer.jetton.address=wallet;expect(matchPaymentEvent(e,expected)).toBeNull()});
 it("rejects unfinished transactions",()=>{const e=event();e.in_progress=true;expect(matchPaymentEvent(e,expected)).toBeNull()});
 it("rejects pre-invoice transactions",()=>{const e=event();e.timestamp=Math.floor((Date.parse(expected.createdAt)-1000)/1000);expect(matchPaymentEvent(e,expected)).toBeNull()});
});