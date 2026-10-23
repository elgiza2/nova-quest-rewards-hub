import { useSearchParams } from "react-router-dom";
import ManualCryptoPayment from "@/components/billing/ManualCryptoPayment";
export default function CryptoCheckoutInner() {
 const [params]=useSearchParams();
 return <div className="mx-auto max-w-xl px-5 py-8"><ManualCryptoPayment tier={params.get("tier")||"pro"} interval={params.get("interval")||"monthly"} sku={params.get("sku")}/></div>;
}
