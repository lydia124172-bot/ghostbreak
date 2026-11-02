function clientId() {
  return String(process.env.PAYPAL_CLIENT_ID || '').trim();
}

function secret() {
  return String(process.env.PAYPAL_SECRET || '').trim();
}

function configured() {
  return Boolean(clientId() && secret());
}

function apiBase() {
  return String(process.env.PAYPAL_SANDBOX || '').trim() === '1'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function accessToken() {
  const auth = Buffer.from(`${clientId()}:${secret()}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'PayPal 連線失敗');
  return data.access_token;
}

async function createOrder({ amount, itemName, customId, returnUrl, cancelUrl }) {
  if (!configured()) throw new Error('PayPal 尚未開通。');
  const token = await accessToken();
  const total = String(Math.max(1, Math.round(Number(amount) || 0)));
  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(customId || '').slice(0, 256),
        custom_id: String(customId || '').slice(0, 127),
        description: String(itemName || '麋鹿網方案').slice(0, 127),
        amount: { currency_code: 'TWD', value: total },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: '麋鹿網',
            locale: 'zh-TW',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '無法建立 PayPal 付款');
  const link = (data.links || []).find((item) => item.rel === 'payer-action' || item.rel === 'approve');
  if (!link?.href) throw new Error('PayPal 沒有回付款頁');
  return { id: data.id, url: link.href };
}

function readCaptured(data) {
  const unit = (data.purchase_units || [])[0] || {};
  const capture = (unit.payments && unit.payments.captures && unit.payments.captures[0]) || {};
  const ok = data.status === 'COMPLETED' || capture.status === 'COMPLETED';
  return {
    ok,
    amount: Number(capture.amount?.value || unit.amount?.value || 0),
    customId: String(unit.custom_id || unit.reference_id || ''),
    captureId: String(capture.id || data.id || ''),
  };
}

async function getOrder(orderId, token) {
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'PayPal 訂單讀取失敗');
  return data;
}

async function captureOrder(orderId) {
  if (!configured()) throw new Error('PayPal 尚未開通。');
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  const issue = data.details && data.details[0] && data.details[0].issue;
  if (!res.ok && issue === 'ORDER_ALREADY_CAPTURED') return readCaptured(await getOrder(orderId, token));
  if (!res.ok) throw new Error(data.message || 'PayPal 收款失敗');
  return readCaptured(data);
}

module.exports = { configured, createOrder, captureOrder };
