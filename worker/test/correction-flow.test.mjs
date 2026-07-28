import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.js';

class MemoryKV {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  async get(key, options = {}) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }
}

test('el formulario seguro acepta una corrección, quema el token y conserva la segunda gratis', async (t) => {
  const token = 'token-seguro-de-prueba-1234567890';
  const slug = 'cliente-hmu-prueba';
  const kv = new MemoryKV({
    [`hmu_correction:${token}`]: JSON.stringify({
      correction_token: token,
      order_id: 'cs_test_hmu',
      slug,
      lang: 'es',
      paid: false,
      used_at: null,
    }),
    [`hmu_delivery:${slug}`]: JSON.stringify({
      order_id: 'cs_test_hmu',
      slug,
      lang: 'es',
      free_total: 2,
      free_used: 0,
    }),
  });
  const dispatches = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    assert.match(String(url), /api\.github\.com\/repos\/yuyitov\/service-menu-app\/dispatches$/);
    dispatches.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  });

  const env = {
    SERVICE_MENU_KV: kv,
    PRODUCT_ID: 'hmu',
    BRAND_NAME: 'HMU Link',
    PUBLIC_BOOK_BASE_URL: 'https://www.hmulink.com',
    WORKER_PUBLIC_URL: 'https://service-menu-worker.example',
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPO: 'yuyitov/service-menu-app',
    GITHUB_ACTIONS_EVENT: 'new-hmu-service-menu',
    FREE_CHANGES: '2',
  };

  const statusBefore = await worker.fetch(
    new Request(`https://worker.example/correction-status?t=${token}`),
    env,
    {},
  );
  assert.equal(statusBefore.status, 200);
  assert.deepEqual(await statusBefore.json(), {
    ok: true,
    state: 'valid',
    slug,
    page_url: `https://www.hmulink.com/links/${slug}/`,
  });

  const first = await worker.fetch(
    new Request('https://worker.example/correct', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        changes: 'Cambiar el teléfono público a +52 322 123 4567.',
      }),
    }),
    env,
    {},
  );
  assert.equal(first.status, 200);
  const accepted = await first.json();
  assert.equal(accepted.ok, true);
  assert.equal(accepted.slug, slug);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].event_type, 'new-hmu-service-menu');
  assert.equal(dispatches[0].client_payload.is_correction, true);
  assert.equal(dispatches[0].client_payload.slug, slug);
  assert.equal(dispatches[0].client_payload.correction_text, 'Cambiar el teléfono público a +52 322 123 4567.');
  assert.equal('token' in dispatches[0].client_payload, false);
  assert.equal('order_id' in dispatches[0].client_payload, false);

  const usedRecord = await kv.get(`hmu_correction:${token}`, { type: 'json' });
  assert.ok(usedRecord.used_at);
  const delivery = await kv.get(`hmu_delivery:${slug}`, { type: 'json' });
  assert.equal(delivery.free_total, 2);
  assert.equal(delivery.free_used, 1);
  assert.ok(delivery.correction_token);
  assert.notEqual(delivery.correction_token, token);

  const second = await worker.fetch(
    new Request('https://worker.example/correct', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        changes: 'Intento repetido que no debe volver a despacharse.',
      }),
    }),
    env,
    {},
  );
  assert.equal(second.status, 403);
  assert.equal((await second.json()).state, 'used');
  assert.equal(dispatches.length, 1);
});
