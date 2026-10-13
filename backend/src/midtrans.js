import { createHash, timingSafeEqual } from "node:crypto";

export function apiBase(isProduction) {
  return isProduction
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}

export function signature(orderId, statusCode, grossAmount, serverKey) {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");
}

export function signaturesMatch(received, expected) {
  const left = Buffer.from(String(received || "").toLowerCase());
  const right = Buffer.from(String(expected || "").toLowerCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function quotedField(raw, key) {
  const match = String(raw || "").match(
    new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`),
  );
  return match ? match[1] : "";
}

export function signedFields(rawBody, body) {
  const pick = (key) => {
    const quoted = quotedField(rawBody, key);
    if (quoted) return quoted;
    if (body?.[key] === undefined || body?.[key] === null) return "";
    return String(body[key]);
  };
  return {
    orderId: pick("order_id"),
    statusCode: pick("status_code"),
    grossAmount: pick("gross_amount"),
  };
}

export async function createQrisCharge({
  serverKey,
  isProduction,
  notificationUrl,
  orderId,
  amount,
}) {
  const auth = Buffer.from(`${serverKey}:`).toString("base64");
  const response = await fetch(`${apiBase(isProduction)}/v2/charge`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      "X-Override-Notification": notificationUrl,
    },
    body: JSON.stringify({
      payment_type: "qris",
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      qris: { acquirer: "gopay" },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.qr_string) {
    const message = payload.status_message || `Midtrans menolak charge (${response.status})`;
    const error = new Error(message);
    error.status = 502;
    throw error;
  }
  const qrAction = (payload.actions || []).find(
    (item) => item.name === "generate-qr-code",
  );
  return {
    orderId: payload.order_id || orderId,
    grossAmount: amount,
    qrString: payload.qr_string,
    qrUrl: qrAction?.url || "",
    status: payload.transaction_status || "pending",
  };
}
