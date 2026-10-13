import { createHmac, timingSafeEqual } from "node:crypto";

export function apiBase(isProduction) {
  return isProduction
    ? "https://passport.duitku.com/webapi/api/merchant"
    : "https://sandbox.duitku.com/webapi/api/merchant";
}

export function hmacSign(payload, apiKey) {
  return createHmac("sha256", apiKey).update(String(payload)).digest("hex");
}

export function inquirySignature(merchantCode, merchantOrderId, paymentAmount, apiKey) {
  return hmacSign(`${merchantCode}${merchantOrderId}${paymentAmount}`, apiKey);
}

export function callbackSignature(merchantCode, amount, merchantOrderId, apiKey) {
  return hmacSign(`${merchantCode}${amount}${merchantOrderId}`, apiKey);
}

export function statusSignature(merchantCode, merchantOrderId, apiKey) {
  return hmacSign(`${merchantCode}${merchantOrderId}`, apiKey);
}

export function signaturesMatch(received, expected) {
  const left = Buffer.from(String(received || "").toLowerCase());
  const right = Buffer.from(String(expected || "").toLowerCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function createQrisInquiry({
  merchantCode,
  apiKey,
  isProduction,
  paymentMethod,
  email,
  customerName,
  callbackUrl,
  returnUrl,
  orderId,
  amount,
}) {
  const paymentAmount = String(amount);
  const response = await fetch(`${apiBase(isProduction)}/v2/inquiry`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merchantCode,
      paymentAmount: amount,
      merchantOrderId: orderId,
      productDetails: "Pembayaran QRIS",
      email,
      paymentMethod,
      customerVaName: String(customerName).slice(0, 20),
      callbackUrl,
      returnUrl,
      signature: inquirySignature(merchantCode, orderId, paymentAmount, apiKey),
      expiryPeriod: 15,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.statusCode !== "00" || !payload.qrString) {
    const message = payload.statusMessage || `Duitku menolak inquiry (${response.status})`;
    const error = new Error(message);
    error.status = 502;
    throw error;
  }
  return {
    orderId,
    qrString: payload.qrString,
    reference: payload.reference || "",
    paymentUrl: payload.paymentUrl || "",
  };
}

export async function transactionStatus({
  merchantCode,
  apiKey,
  isProduction,
  orderId,
}) {
  const response = await fetch(`${apiBase(isProduction)}/transactionStatus`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merchantCode,
      merchantOrderId: orderId,
      signature: statusSignature(merchantCode, orderId, apiKey),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.statusMessage || `Duitku menolak status (${response.status})`);
    error.status = 502;
    throw error;
  }
  return { statusCode: String(payload.statusCode || "") };
}
