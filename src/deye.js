// Мінімальний клієнт Deye Cloud (developer API).
const enc = new TextEncoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST до Deye з повторами: тимчасові збої (HTML замість JSON, 5xx, мережа) не мають
// призводити до хибного "світла немає", бо тоді пінг не надсилається.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

async function deyePost(url, init) {
  let lastError;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { method: 'POST', ...init });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        const snippet = text.replace(/\s+/g, ' ').slice(0, 120);
        throw new Error(`Deye: відповідь не JSON (HTTP ${res.status}): ${snippet}`);
      }
    } catch (e) {
      lastError = e;
      console.warn(`Deye запит, спроба ${i}/${ATTEMPTS}: ${e.message}`);
      if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

async function fetchToken(env) {
  const json = await deyePost(`${env.DEYE_BASE_URL}/account/token?appId=${env.DEYE_APP_ID}`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appSecret: env.DEYE_APP_SECRET,
      email: env.DEYE_EMAIL,
      password: await sha256Hex(env.DEYE_PASSWORD),
    }),
  });
  if (!json.success || !json.accessToken) {
    throw new Error(`Deye token error: ${json.code} ${json.msg}`);
  }
  return json.accessToken;
}

// Токен живе ~2 місяці. Кешуємо в KV на 30 днів (Cloudflare, env.TOKENS),
// інакше — в пам'яті процесу (AWS Lambda / GCP, поки інстанс "теплий").
let memoryToken = null;

async function getToken(env, force = false) {
  if (!force) {
    const cached = env.TOKENS ? await env.TOKENS.get('deye_token') : memoryToken;
    if (cached) return cached;
  }
  const token = await fetchToken(env);
  memoryToken = token;
  if (env.TOKENS) await env.TOKENS.put('deye_token', token, { expirationTtl: 60 * 60 * 24 * 30 });
  return token;
}

async function latest(env, token) {
  return deyePost(`${env.DEYE_BASE_URL}/device/latest`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceList: [env.DEYE_DEVICE_SN] }),
  });
}

export async function getDeviceData(env) {
  let json = await latest(env, await getToken(env));
  if (!json.success) {
    // токен міг протухнути — оновлюємо один раз
    json = await latest(env, await getToken(env, true));
  }
  if (!json.success) throw new Error(`Deye latest error: ${json.code} ${json.msg}`);
  const device = json.deviceDataList?.[0];
  if (!device) throw new Error('Deye: device not found in response');
  return device; // { deviceSn, deviceState, dataList: [{key, value, unit, name}], ... }
}
