// Мінімальний клієнт Deye Cloud (developer API).
const enc = new TextEncoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchToken(env) {
  const res = await fetch(`${env.DEYE_BASE_URL}/account/token?appId=${env.DEYE_APP_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appSecret: env.DEYE_APP_SECRET,
      email: env.DEYE_EMAIL,
      password: await sha256Hex(env.DEYE_PASSWORD),
    }),
  });
  const json = await res.json();
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
  const res = await fetch(`${env.DEYE_BASE_URL}/device/latest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceList: [env.DEYE_DEVICE_SN] }),
  });
  return res.json();
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
