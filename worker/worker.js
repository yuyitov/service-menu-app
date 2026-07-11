/**
 * HMU Link Service Menu Worker
 *
 * Stripe → Worker → KV → GitHub Actions → GitHub Pages
 *
 * Flujo:
 * 1. Stripe payment → webhook → create hmu_order in KV
 * 2. Send post-payment email with Tally form link (pre-filled with order_id)
 * 3. Customer fills Tally → webhook → validate order + save submission
 * 4. Dispatch GitHub Actions to generate service menu page
 * 5. GitHub Actions calls /notify → send delivery email (includes a one-time
 *    correction link to https://www.hmulink.com/correct/?t=<token>)
 *
 * Flujo de correcciones (gratuita incluida + adicionales de pago):
 * a. /notify genera un correction_token de un solo uso (KV hmu_correction:*)
 *    y el correo de entrega enlaza la página /correct/ con ese token.
 * b. La página estática /correct/ llama GET /correction-status y luego
 *    POST /correct — el token autentica; no hay formulario de Tally.
 * c. /correct despacha GitHub Actions (is_correction) → apply_correction.py
 *    edita data/clients/<slug>.client.json y regenera la página; Actions llama
 *    /notify con correction_id + correction_status (applied|manual) y aquí se
 *    manda el correo de confirmación (y copia a REPLY_TO_EMAIL).
 * d. Correcciones adicionales ($3 USD / $40 MXN, sección 3/6 de los Términos):
 *    GET /buy-correction?slug=… crea un Stripe Checkout Session (requiere el
 *    secret STRIPE_SECRET_KEY; sin él redirige a la página de contacto). El
 *    webhook detecta metadata hmu_correction=1, acuña un token nuevo y se lo
 *    manda por correo al email del pedido original (nunca al comprador si no
 *    coincide — pagar por la página de otro solo le regala la corrección).
 *
 * Environment variables (non-secret):
 * - GITHUB_REPO = yuyitov/service-menu-app
 * - GITHUB_ACTIONS_EVENT = new-hmu-service-menu
 * - TALLY_FORM_URL_EN = https://tally.so/r/yPkN5X?order_id=
 * - TALLY_FORM_URL_ES = https://tally.so/r/MeyDpk?order_id=
 * - FROM_EMAIL = HMU Link <hello@hmulink.com>
 * - PUBLIC_BOOK_BASE_URL = https://www.hmulink.com
 *
 * Secrets (in Cloudflare):
 * - STRIPE_WEBHOOK_SECRET
 * - TALLY_SIGNING_SECRET_EN (form yPkN5X has its own signing secret)
 * - TALLY_SIGNING_SECRET_ES (form MeyDpk has its own signing secret)
 * - GITHUB_TOKEN
 * - SENDGRID_API_KEY
 * - NOTIFY_SECRET
 * - STRIPE_SECRET_KEY (opcional — solo lo usa /buy-correction para crear
 *   Checkout Sessions de correcciones adicionales; usar una key RESTRINGIDA
 *   con permiso de escritura solo en Checkout Sessions)
 */

const VALID_BRAND_STYLES = [
  'black-gold', 'soft-blush', 'charcoal-clean', 'warm-sand',
  'aqua-clean', 'sage-calm', 'electric-slate', 'terracotta-warm',
  'sunny-paws', 'midnight-ink', 'clarity-editorial', 'horizon-teal'
];

// Precio de la corrección adicional — DEBE coincidir con la sección 3 de los
// Términos publicados (public/terms/ y public/es/terminos/): ~$3 USD / ~$40 MXN.
const CORRECTION_PRICE = {
  usd: { unit_amount: 300, label: '$3 USD' },
  mxn: { unit_amount: 4000, label: '$40 MXN' }
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;
// Límites del texto libre de corrección: viaja en client_payload (visible en
// logs públicos de Actions) y se pega en el prompt del LLM — acotarlo.
const CORRECTION_TEXT_MIN = 5;
const CORRECTION_TEXT_MAX = 3000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const minuteSlot = Math.floor(Date.now() / 60000);

      if (request.method === 'GET' && pathname === '/health') {
        return jsonResponse({ ok: true, worker: 'service-menu-worker' });
      }

      if (request.method === 'POST' && pathname === '/stripe/webhook') {
        // Cap junk floods before spending CPU on HMAC verification. Stripe's
        // real volume for this business is far below 60/min per source IP;
        // a 429 just makes Stripe retry with backoff.
        const allowed = await checkRateLimit(env, `hmu_rl:stripe:${ip}:${minuteSlot}`, 60, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleStripeWebhook(request, env);
      }

      if (request.method === 'POST' && pathname === '/tally-webhook') {
        const allowed = await checkRateLimit(env, `hmu_rl:tally:${ip}:${minuteSlot}`, 10, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleTallyWebhook(request, env);
      }

      if (request.method === 'POST' && pathname === '/notify') {
        const allowed = await checkRateLimit(env, `hmu_rl:notify:${ip}:${minuteSlot}`, 20, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleNotify(request, env);
      }

      // Correcciones: consumidos por la página estática /correct/ del sitio.
      if (request.method === 'GET' && pathname === '/correction-status') {
        const allowed = await checkRateLimit(env, `hmu_rl:corrstatus:${ip}:${minuteSlot}`, 30, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleCorrectionStatus(url, env);
      }

      if (request.method === 'POST' && pathname === '/correct') {
        const allowed = await checkRateLimit(env, `hmu_rl:correct:${ip}:${minuteSlot}`, 10, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleCorrectionRequest(request, env);
      }

      if (request.method === 'GET' && pathname === '/buy-correction') {
        const allowed = await checkRateLimit(env, `hmu_rl:buycorr:${ip}:${minuteSlot}`, 10, 120);
        if (!allowed) return jsonResponse({ ok: false, error: 'Too many requests' }, 429);
        return await handleBuyCorrection(url, env);
      }

      return jsonResponse({ ok: false, error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', safeError(error));
      return jsonResponse(
        { ok: false, error: 'Internal worker error' },
        500
      );
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: 'Stripe webhook not configured' }, 500);
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('stripe-signature') || '';

  const valid = await validateStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return jsonResponse({ ok: false, error: 'Invalid Stripe signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const type = event?.type;
  if (type !== 'checkout.session.completed' && type !== 'payment_intent.succeeded') {
    return jsonResponse({ ok: true, ignored: true, type });
  }

  const session = event?.data?.object || {};

  // Compras de corrección adicional: son Checkout Sessions creadas por este
  // mismo worker en /buy-correction (no payment links), marcadas con metadata.
  // Se atienden ANTES del filtro de payment_link — no traen payment_link.
  if (type === 'checkout.session.completed' && session?.metadata?.hmu_correction === '1') {
    return await handleCorrectionPurchase(session, env);
  }

  // Product filter: the Stripe account is shared with other products (MyGuest),
  // so every webhook receives every sale. Only checkout.session.completed
  // carries payment_link; payment_intent.succeeded can't be attributed to a
  // product, so it's ignored when the filter is configured.
  // Accepts one or more payment link ids (comma-separated) so multiple HMU Link
  // checkouts — e.g. the USD ($39) and MXN ($699) links — all resolve to this
  // product while still filtering out other products (MyGuest) on the account.
  const expectedPaymentLinks = (env.STRIPE_PAYMENT_LINK_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  // FAIL CLOSED: the Stripe account is shared with other products (MyGuest,
  // Dr Link, ...) and Stripe fans every signed event to this endpoint. If the
  // allowlist is unset/mistyped (e.g. during a deploy or key rotation) we must
  // NOT process arbitrary payments — that would email the wrong customer the
  // HMU intake form. We still log the observed payment_link so a new one can be
  // captured, but we never create an order or send mail without a match.
  if (expectedPaymentLinks.length === 0) {
    if (type === 'checkout.session.completed') {
      console.log('stripe payment_link observed (filter not configured):', session.payment_link || '(none)');
    }
    return jsonResponse({ ok: true, ignored: true, reason: 'filter_not_configured' });
  }
  if (type !== 'checkout.session.completed') {
    return jsonResponse({ ok: true, ignored: true, reason: 'unattributable_event_type' });
  }
  if (!expectedPaymentLinks.includes(session.payment_link || '')) {
    // Diagnostic: surface filter mismatches (plink ids are not secrets).
    console.log('ignored other_product — observed plink:', session.payment_link || '(none)', '| expected:', expectedPaymentLinks.join(','));
    return jsonResponse({ ok: true, ignored: true, reason: 'other_product' });
  }

  const paymentIntentId =
    type === 'checkout.session.completed'
      ? (session.payment_intent || session.id || '')
      : (session.id || '');
  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    session.receipt_email ||
    '';
  const amountTotal = session.amount_total ?? session.amount ?? 0;
  const currency = session.currency || '';

  if (!paymentIntentId) {
    return jsonResponse({ ok: false, error: 'Missing payment_intent id' }, 400);
  }

  const processedKey = `hmu_processed:${paymentIntentId}`;
  const alreadyProcessed = await env.SERVICE_MENU_KV.get(processedKey).catch(() => null);
  if (alreadyProcessed) {
    return jsonResponse({ ok: true, idempotent: true, paymentIntentId });
  }

  const now = new Date().toISOString();
  const orderId = paymentIntentId;

  // Save order record
  try {
    await env.SERVICE_MENU_KV.put(`hmu_order:${orderId}`, JSON.stringify({
      order_id: orderId,
      payment_intent_id: paymentIntentId,
      customer_email: customerEmail,
      amount: amountTotal,
      currency,
      stripe_event_type: type,
      status: 'paid',
      created_at: now
    }));
  } catch (err) {
    console.error('order record save failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to save order record' }, 500);
  }

  if (!customerEmail) {
    await env.SERVICE_MENU_KV.put(processedKey, '1', { expirationTtl: 604800 });
    return jsonResponse({ ok: true, paymentIntentId, hasEmail: false });
  }

  if (!env.SENDGRID_API_KEY) {
    return jsonResponse({ ok: false, error: 'SENDGRID_API_KEY not configured' }, 500);
  }

  const baseFormEN = (env.TALLY_FORM_URL_EN || '').trim();
  const baseFormES = (env.TALLY_FORM_URL_ES || '').trim();

  if (!baseFormEN || !baseFormES) {
    return jsonResponse({ ok: false, error: 'TALLY_FORM_URL not configured' }, 500);
  }

  // Construct form URLs with order_id
  const formUrlEN = `${baseFormEN}${encodeURIComponent(orderId)}&customer_email=${encodeURIComponent(customerEmail)}`;
  const formUrlES = `${baseFormES}${encodeURIComponent(orderId)}&customer_email=${encodeURIComponent(customerEmail)}`;

  // Reserve the idempotency marker BEFORE sending so a concurrent duplicate
  // (Stripe retry / race) can't double-send the email. If the send fails we
  // clear the marker so Stripe's own retry can try again.
  await env.SERVICE_MENU_KV.put(processedKey, '1', { expirationTtl: 604800 }).catch(() => {});

  // Send post-payment email. Asunto en el idioma del comprador (moneda MXN →
  // español): un asunto en inglés a un cliente mexicano confunde y dispara
  // filtros de spam por incongruencia de idioma.
  const isMxnBuyer = currency.toLowerCase() === 'mxn';
  try {
    await sendEmail({
      env,
      to: customerEmail,
      subject: isMxnBuyer
        ? 'Completa tu página HMU Link — solo falta un formulario'
        : 'Complete your HMU Link service menu — one form to go',
      html: buildPostPaymentEmail({ formUrlEN, formUrlES, lang: isMxnBuyer ? 'es' : 'en' }),
      text: buildPostPaymentText({ formUrlEN, formUrlES, lang: isMxnBuyer ? 'es' : 'en' })
    });
  } catch (err) {
    console.error('post-payment email failed:', safeError(err));
    await env.SERVICE_MENU_KV.delete(processedKey).catch(() => {});
    return jsonResponse({ ok: false, error: 'Failed to send post-payment email' }, 500);
  }

  return jsonResponse({ ok: true, paymentIntentId, hasEmail: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// TALLY WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleTallyWebhook(request, env) {
  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) {
    return jsonResponse({ ok: false, error: 'Could not read request body' }, 400);
  }

  const secrets = [env.TALLY_SIGNING_SECRET_EN, env.TALLY_SIGNING_SECRET_ES].filter(Boolean);
  if (secrets.length === 0) {
    return jsonResponse({ ok: false, error: 'Webhook signature validation not configured' }, 500);
  }

  const sigHeader = request.headers.get('tally-signature') || '';
  let valid = false;
  for (const secret of secrets) {
    if (await verifyTallySignature(rawBody, sigHeader, secret)) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    return jsonResponse({ ok: false, error: 'Invalid webhook signature' }, 401);
  }

  let rawPayload;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  const normalized = normalizeTallyPayload(rawPayload);

  if (!normalized.submission_id) {
    return jsonResponse({ ok: false, error: 'Missing submission_id' }, 400);
  }

  const now = new Date().toISOString();
  const incomingOrderId = cleanValue(getAnswer(normalized.answers, 'order_id')) || '';

  // Guard: require valid order_id
  if (!incomingOrderId) {
    await env.SERVICE_MENU_KV.put(
      `hmu_missing_order:${normalized.submission_id}`,
      JSON.stringify({
        submission_id: normalized.submission_id,
        attempted_at: now
      }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'missing_order_id' }, 403);
  }

  // Validate order exists
  const existingOrder = await env.SERVICE_MENU_KV.get(`hmu_order:${incomingOrderId}`, { type: 'json' }).catch(() => null);
  if (!existingOrder) {
    await env.SERVICE_MENU_KV.put(
      `hmu_invalid_order:${incomingOrderId}:${normalized.submission_id}`,
      JSON.stringify({ order_id: incomingOrderId, submission_id: normalized.submission_id, attempted_at: now }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'invalid_order_id' }, 403);
  }

  // Check order state: only allow generation from 'paid' status
  const allowedStatuses = ['paid', 'form_sent'];
  if (!allowedStatuses.includes(existingOrder.status)) {
    await env.SERVICE_MENU_KV.put(
      `hmu_invalid_order_status:${incomingOrderId}:${normalized.submission_id}`,
      JSON.stringify({ order_id: incomingOrderId, submission_id: normalized.submission_id, blocked_by_status: existingOrder.status, attempted_at: now }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'invalid_order_status' }, 409);
  }

  // Validate email if form includes it
  const formEmail = (cleanValue(getAnswer(normalized.answers, 'customer_email')) || '').toLowerCase().trim();
  const orderEmail = (existingOrder.customer_email || '').toLowerCase().trim();
  if (formEmail && orderEmail && formEmail !== orderEmail) {
    await env.SERVICE_MENU_KV.put(
      `hmu_email_mismatch:${incomingOrderId}:${normalized.submission_id}`,
      JSON.stringify({
        order_id: incomingOrderId,
        submission_id: normalized.submission_id,
        form_email: formEmail,
        order_email: orderEmail,
        attempted_at: now
      }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'order_email_mismatch' }, 403);
  }

  // Build the sanitized public payload (only approved public fields).
  // Internal answers (contact person, private phone, "keep off page" notes)
  // stay in the KV submission record and are never dispatched.
  const publicPayload = buildHmuPublicPayload(normalized, incomingOrderId);

  if (!publicPayload.business_name) {
    await env.SERVICE_MENU_KV.put(
      `hmu_incomplete_intake:${incomingOrderId}:${normalized.submission_id}`,
      JSON.stringify({ order_id: incomingOrderId, submission_id: normalized.submission_id, missing: 'business_name', attempted_at: now }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'incomplete_intake', missing: 'business_name' }, 422);
  }

  const hasContact = publicPayload.whatsapp || publicPayload.phone || publicPayload.public_email || publicPayload.booking_url || publicPayload.website;
  if (!hasContact) {
    await env.SERVICE_MENU_KV.put(
      `hmu_incomplete_intake:${incomingOrderId}:${normalized.submission_id}`,
      JSON.stringify({ order_id: incomingOrderId, submission_id: normalized.submission_id, missing: 'public_contact', attempted_at: now }),
      { expirationTtl: 2592000 }
    ).catch(() => {});
    return jsonResponse({ ok: false, status: 'incomplete_intake', missing: 'public_contact' }, 422);
  }

  const slug = publicPayload.public_slug;

  // Save submission to KV (full answers, private fields included — KV only)
  const submissionKey = `hmu_submission:${normalized.submission_id}`;
  try {
    await env.SERVICE_MENU_KV.put(submissionKey, JSON.stringify({
      submission_id: normalized.submission_id,
      order_id: incomingOrderId,
      customer_email: orderEmail,
      slug,
      answers: normalized.answers,
      received_at: now,
      status: 'received'
    }), { expirationTtl: 7776000 }); // 90 days
  } catch (err) {
    console.error('submission save failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to save submission' }, 500);
  }

  // Update order status to intake_received
  try {
    existingOrder.status = 'intake_received';
    existingOrder.submission_id = normalized.submission_id;
    existingOrder.slug = slug;
    existingOrder.updated_at = now;
    await env.SERVICE_MENU_KV.put(`hmu_order:${incomingOrderId}`, JSON.stringify(existingOrder));
  } catch (err) {
    console.error('order update failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to update order' }, 500);
  }

  // Dispatch GitHub Actions to generate page.
  // The full public payload travels in client_payload (MyGuest pattern):
  // GitHub Actions never needs KV access.
  // OJO: NO incluir order_id — GitHub imprime el env de cada step en los logs
  // públicos del repo. El workflow notifica con submission_id y el worker
  // resuelve el order_id desde KV.
  try {
    await dispatchGitHubAction(env, {
      submission_id: normalized.submission_id,
      slug,
      public_payload: publicPayload
    });
  } catch (err) {
    console.error('github dispatch failed:', safeError(err));
    await env.SERVICE_MENU_KV.put(`hmu_order:${incomingOrderId}`, JSON.stringify({
      ...existingOrder,
      status: 'failed_dispatch',
      updated_at: now
    }));
    return jsonResponse({ ok: false, error: 'Failed to dispatch generation' }, 500);
  }

  // Update order to 'generating'
  try {
    existingOrder.status = 'generating';
    existingOrder.updated_at = now;
    await env.SERVICE_MENU_KV.put(`hmu_order:${incomingOrderId}`, JSON.stringify(existingOrder));
  } catch (err) {
    console.error('status update failed:', safeError(err));
  }

  return jsonResponse({
    ok: true,
    submission_id: normalized.submission_id,
    order_id: incomingOrderId,
    slug,
    status: 'generating'
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY EMAIL HANDLER (called by GitHub Actions post-generation)
// ─────────────────────────────────────────────────────────────────────────────

async function handleNotify(request, env) {
  const notifySecret = (env.NOTIFY_SECRET || '').trim();
  if (!notifySecret) {
    return jsonResponse({ ok: false, error: 'NOTIFY_SECRET not configured' }, 500);
  }

  const authHeader = request.headers.get('authorization') || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!timingSafeEqual(provided, notifySecret)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  // Notificación de corrección aplicada (Actions manda correction_id en vez
  // de submission_id) — camino separado del delivery inicial.
  if ((body?.correction_id || '').trim()) {
    return await handleCorrectionNotify(body, env);
  }

  const slug = (body?.slug || '').trim();
  const submissionId = (body?.submission_id || '').trim();
  let orderId = (body?.order_id || '').trim();

  // El workflow ya no conoce el order_id (no viaja en client_payload para no
  // aparecer en logs públicos de Actions); se resuelve desde la submission.
  if (!orderId && submissionId) {
    const submission = await env.SERVICE_MENU_KV.get(`hmu_submission:${submissionId}`, { type: 'json' }).catch(() => null);
    orderId = (submission?.order_id || '').trim();
  }

  if (!slug || !orderId) {
    return jsonResponse({ ok: false, error: 'Missing slug or order reference' }, 400);
  }

  // Get order from KV
  const order = await env.SERVICE_MENU_KV.get(`hmu_order:${orderId}`, { type: 'json' }).catch(() => null);
  if (!order) {
    return jsonResponse({ ok: false, error: 'Order not found' }, 404);
  }

  const customerEmail = order.customer_email || '';
  if (!customerEmail) {
    return jsonResponse({ ok: false, error: 'No customer email on record' }, 400);
  }

  // Check if already delivered
  const deliveryKey = `hmu_delivery:${slug}`;
  const existingDelivery = await env.SERVICE_MENU_KV.get(deliveryKey, { type: 'json' }).catch(() => null);
  if (existingDelivery && existingDelivery.status === 'delivered') {
    return jsonResponse({ ok: true, slug, idempotent: true, alreadyDelivered: true });
  }

  // Generate correction token
  const correctionToken = generateSecureToken();

  const baseUrl = (env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim();
  const pageUrl = `${baseUrl}/links/${slug}/`;

  // Idioma del cuerpo = idioma del comprador (moneda MXN → español), igual que
  // el asunto. Se guarda también en el token para los correos de corrección.
  const deliveryLang = (order.currency || '').toLowerCase() === 'mxn' ? 'es' : 'en';

  // Save correction token (la corrección gratuita incluida)
  try {
    await env.SERVICE_MENU_KV.put(`hmu_correction:${correctionToken}`, JSON.stringify({
      correction_token: correctionToken,
      order_id: orderId,
      slug,
      lang: deliveryLang,
      paid: false,
      created_at: new Date().toISOString(),
      used_at: null
    }), { expirationTtl: 2592000 }); // 30 days
  } catch (err) {
    console.error('correction token save failed:', safeError(err));
  }

  // Save delivery record
  try {
    await env.SERVICE_MENU_KV.put(deliveryKey, JSON.stringify({
      slug,
      order_id: orderId,
      customer_email: customerEmail,
      page_url: pageUrl,
      correction_token: correctionToken,
      status: 'delivered',
      delivered_at: new Date().toISOString()
    }), { expirationTtl: 7776000 }); // 90 days
  } catch (err) {
    console.error('delivery record save failed:', safeError(err));
  }

  // Send delivery email
  if (!env.SENDGRID_API_KEY) {
    return jsonResponse({ ok: false, error: 'SENDGRID_API_KEY not configured' }, 500);
  }

  const correctionUrl = correctionFormUrl(env, correctionToken, deliveryLang);
  try {
    await sendEmail({
      env,
      to: customerEmail,
      subject: deliveryLang === 'es'
        ? '¡Tu página HMU Link está lista! 🎉'
        : 'Your HMU Link service menu is ready! 🎉',
      html: buildDeliveryEmail({
        pageUrl,
        slug,
        lang: deliveryLang,
        correctionUrl
      }),
      text: buildDeliveryText({ pageUrl, lang: deliveryLang, correctionUrl })
    });
  } catch (err) {
    console.error('delivery email failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to send delivery email' }, 500);
  }

  // Update order status to delivered
  try {
    order.status = 'delivered';
    order.updated_at = new Date().toISOString();
    await env.SERVICE_MENU_KV.put(`hmu_order:${orderId}`, JSON.stringify(order));
  } catch (err) {
    console.error('order status update failed:', safeError(err));
  }

  return jsonResponse({
    ok: true,
    slug,
    status: 'delivered',
    pageUrl
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTIONS — status, request, purchase, notify
// ─────────────────────────────────────────────────────────────────────────────

function correctionFormUrl(env, token, lang) {
  const baseUrl = (env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim();
  return `${baseUrl}/correct/?t=${encodeURIComponent(token)}&l=${lang === 'es' ? 'es' : 'en'}`;
}

// La compra de corrección adicional pasa por el worker (crea el Checkout
// Session al vuelo); la página /correct/ y los correos enlazan esta URL.
function buyCorrectionUrl(env, slug) {
  const workerBase = (env.WORKER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!workerBase) return '';
  return `${workerBase}/buy-correction?slug=${encodeURIComponent(slug)}`;
}

// GET /correction-status?t=<token> — estado del token para la página /correct/.
// Un token es un secreto de 32 chars aleatorios: responder estado + slug a
// quien lo tenga no filtra nada que el dueño no sepa ya.
async function handleCorrectionStatus(url, env) {
  const token = (url.searchParams.get('t') || '').trim();
  if (!token || token.length > 64) {
    return jsonResponse({ ok: true, state: 'invalid' });
  }
  const record = await env.SERVICE_MENU_KV.get(`hmu_correction:${token}`, { type: 'json' }).catch(() => null);
  if (!record) {
    return jsonResponse({ ok: true, state: 'invalid' });
  }
  const baseUrl = (env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim();
  if (record.used_at) {
    return jsonResponse({
      ok: true,
      state: 'used',
      buy_url: buyCorrectionUrl(env, record.slug)
    });
  }
  return jsonResponse({
    ok: true,
    state: 'valid',
    slug: record.slug,
    page_url: `${baseUrl}/links/${record.slug}/`
  });
}

// POST /correct — body JSON {token, changes}. El token de un solo uso
// autentica (nace en el correo de entrega o en una compra de corrección).
async function handleCorrectionRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const token = cleanValue(body?.token);
  // El texto viaja en client_payload (logs públicos de Actions) y la página
  // /correct/ lo advierte: solo cambios para la página pública, nada privado.
  const changes = String(body?.changes || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

  if (!token || token.length > 64) {
    return jsonResponse({ ok: false, state: 'invalid' }, 403);
  }
  if (changes.length < CORRECTION_TEXT_MIN) {
    return jsonResponse({ ok: false, error: 'changes_too_short' }, 400);
  }
  if (changes.length > CORRECTION_TEXT_MAX) {
    return jsonResponse({ ok: false, error: 'changes_too_long' }, 400);
  }

  const record = await env.SERVICE_MENU_KV.get(`hmu_correction:${token}`, { type: 'json' }).catch(() => null);
  if (!record) {
    return jsonResponse({ ok: false, state: 'invalid' }, 403);
  }
  if (record.used_at) {
    return jsonResponse({ ok: false, state: 'used', buy_url: buyCorrectionUrl(env, record.slug) }, 403);
  }

  const slug = record.slug;
  const now = new Date().toISOString();
  const correctionId = `c${generateSecureToken().slice(0, 20)}`;

  // El registro guarda el texto completo (KV, privado); a Actions solo viaja
  // el texto saneado + slug + correction_id — nunca order_id ni el token.
  try {
    await env.SERVICE_MENU_KV.put(`hmu_correction_request:${correctionId}`, JSON.stringify({
      correction_id: correctionId,
      correction_token: token,
      order_id: record.order_id,
      slug,
      lang: record.lang === 'es' ? 'es' : 'en',
      paid: !!record.paid,
      changes,
      status: 'dispatched',
      created_at: now
    }), { expirationTtl: 7776000 }); // 90 days
  } catch (err) {
    console.error('correction request save failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to save correction' }, 500);
  }

  try {
    await dispatchGitHubAction(env, {
      is_correction: true,
      correction_id: correctionId,
      slug,
      correction_text: changes
    });
  } catch (err) {
    // El token NO se quema si el dispatch falla: el cliente puede reintentar.
    console.error('github dispatch for correction failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to dispatch correction' }, 500);
  }

  // Quemar el token después del dispatch exitoso. (Ventana de carrera entre
  // dos POST simultáneos con el mismo token: aceptada — el rate limit la acota
  // y el peor caso es una regeneración doble de la misma página.)
  try {
    record.used_at = now;
    record.correction_id = correctionId;
    await env.SERVICE_MENU_KV.put(`hmu_correction:${token}`, JSON.stringify(record), { expirationTtl: 7776000 });
  } catch (err) {
    console.error('correction token update failed:', safeError(err));
  }

  // Copia de auditoría para Verónica — nunca bloquea la respuesta al cliente.
  await notifyAdmin(env, `HMU corrección solicitada — ${slug}`, [
    `Corrección ${record.paid ? 'ADICIONAL (pagada)' : 'gratuita'} solicitada.`,
    `Página: https://www.hmulink.com/links/${slug}/`,
    `correction_id: ${correctionId}`,
    '',
    'Cambios pedidos por el cliente:',
    changes
  ]);

  return jsonResponse({ ok: true, correction_id: correctionId, slug });
}

// GET /buy-correction?slug=<slug> — crea un Stripe Checkout Session para una
// corrección adicional y redirige. Sin STRIPE_SECRET_KEY (o sin registro de
// entrega) redirige a /correct/?buy=unavailable, que ofrece WhatsApp/correo.
// Seguridad: cualquiera puede pagar por cualquier slug, pero el token acuñado
// se envía SOLO al email del pedido original — pagar por la página de un
// tercero únicamente le regala una corrección al dueño.
async function handleBuyCorrection(url, env) {
  const baseUrl = (env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim();
  const unavailableUrl = `${baseUrl}/correct/?buy=unavailable`;

  const slug = (url.searchParams.get('slug') || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return Response.redirect(unavailableUrl, 302);
  }

  const delivery = await env.SERVICE_MENU_KV.get(`hmu_delivery:${slug}`, { type: 'json' }).catch(() => null);
  if (!delivery || !env.STRIPE_SECRET_KEY) {
    return Response.redirect(unavailableUrl, 302);
  }

  const order = delivery.order_id
    ? await env.SERVICE_MENU_KV.get(`hmu_order:${delivery.order_id}`, { type: 'json' }).catch(() => null)
    : null;
  const currency = (order?.currency || '').toLowerCase() === 'mxn' ? 'mxn' : 'usd';
  const lang = currency === 'mxn' ? 'es' : 'en';
  const price = CORRECTION_PRICE[currency];

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', currency);
  params.set('line_items[0][price_data][unit_amount]', String(price.unit_amount));
  params.set(
    'line_items[0][price_data][product_data][name]',
    lang === 'es' ? 'HMU Link — Corrección adicional' : 'HMU Link — Extra correction'
  );
  params.set('metadata[hmu_correction]', '1');
  params.set('metadata[slug]', slug);
  params.set('success_url', `${baseUrl}/correct/thanks/?l=${lang}`);
  params.set('cancel_url', `${baseUrl}/links/${slug}/`);
  if (delivery.customer_email) {
    params.set('customer_email', delivery.customer_email);
  }

  let session;
  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    if (!resp.ok) {
      console.error('checkout session create failed:', resp.status);
      return Response.redirect(unavailableUrl, 302);
    }
    session = await resp.json();
  } catch (err) {
    console.error('checkout session create error:', safeError(err));
    return Response.redirect(unavailableUrl, 302);
  }

  if (!session?.url) {
    return Response.redirect(unavailableUrl, 302);
  }
  return Response.redirect(session.url, 302);
}

// Webhook: pago de corrección adicional → acuñar token nuevo y mandarlo al
// email del pedido original.
async function handleCorrectionPurchase(session, env) {
  const paymentIntentId = session.payment_intent || session.id || '';
  if (!paymentIntentId) {
    return jsonResponse({ ok: false, error: 'Missing payment_intent id' }, 400);
  }

  const processedKey = `hmu_processed:${paymentIntentId}`;
  const alreadyProcessed = await env.SERVICE_MENU_KV.get(processedKey).catch(() => null);
  if (alreadyProcessed) {
    return jsonResponse({ ok: true, idempotent: true, paymentIntentId });
  }

  const slug = cleanValue(session.metadata?.slug || '').toLowerCase();
  const buyerEmail = session.customer_email || session.customer_details?.email || '';
  const delivery = SLUG_RE.test(slug)
    ? await env.SERVICE_MENU_KV.get(`hmu_delivery:${slug}`, { type: 'json' }).catch(() => null)
    : null;
  const order = delivery?.order_id
    ? await env.SERVICE_MENU_KV.get(`hmu_order:${delivery.order_id}`, { type: 'json' }).catch(() => null)
    : null;
  // SOLO el email del pedido/entrega original recibe el token (nunca el
  // comprador de la sesión si no hay registro — eso sería regalar acceso).
  const ownerEmail = order?.customer_email || delivery?.customer_email || '';
  const currency = (session.currency || order?.currency || 'usd').toLowerCase();
  const lang = currency === 'mxn' ? 'es' : 'en';

  await env.SERVICE_MENU_KV.put(processedKey, '1', { expirationTtl: 604800 }).catch(() => {});

  if (!delivery || !ownerEmail) {
    // Sin registro de entrega no se puede acuñar con seguridad: atender a mano.
    await notifyAdmin(env, `HMU corrección pagada SIN registro — atender manual`, [
      'Se pagó una corrección adicional pero no hay registro de entrega en KV.',
      `slug (metadata): ${slug || '(vacío)'}`,
      `email del comprador (Stripe): ${buyerEmail || '(sin email)'}`,
      `payment_intent: ${paymentIntentId}`,
      '',
      'Acción: aplicar la corrección manualmente o reembolsar.'
    ]);
    return jsonResponse({ ok: true, manual: true, paymentIntentId });
  }

  const token = generateSecureToken();
  try {
    await env.SERVICE_MENU_KV.put(`hmu_correction:${token}`, JSON.stringify({
      correction_token: token,
      order_id: delivery.order_id || '',
      slug,
      lang,
      paid: true,
      created_at: new Date().toISOString(),
      used_at: null
    }), { expirationTtl: 2592000 }); // 30 days
  } catch (err) {
    console.error('paid correction token save failed:', safeError(err));
    await env.SERVICE_MENU_KV.delete(processedKey).catch(() => {});
    return jsonResponse({ ok: false, error: 'Failed to save correction token' }, 500);
  }

  const formUrl = correctionFormUrl(env, token, lang);
  const pageUrl = `${(env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim()}/links/${slug}/`;
  try {
    await sendEmail({
      env,
      to: ownerEmail,
      subject: lang === 'es'
        ? 'Tu corrección adicional de HMU Link — pídela aquí'
        : 'Your extra HMU Link correction — request it here',
      html: buildCorrectionPurchaseEmail({ formUrl, pageUrl, lang }),
      text: buildCorrectionPurchaseText({ formUrl, pageUrl, lang })
    });
  } catch (err) {
    console.error('correction purchase email failed:', safeError(err));
    await env.SERVICE_MENU_KV.delete(processedKey).catch(() => {});
    return jsonResponse({ ok: false, error: 'Failed to send correction email' }, 500);
  }

  await notifyAdmin(env, `HMU corrección adicional comprada — ${slug}`, [
    `Corrección adicional pagada (${CORRECTION_PRICE[currency === 'mxn' ? 'mxn' : 'usd'].label}).`,
    `Página: ${pageUrl}`,
    `Token enviado a: ${ownerEmail}`,
    `payment_intent: ${paymentIntentId}`
  ]);

  return jsonResponse({ ok: true, paymentIntentId, slug });
}

// /notify con correction_id — Actions terminó de procesar la corrección.
// correction_status: 'applied' (página regenerada) | 'manual' (el LLM no pudo
// aplicarla con seguridad; se atiende a mano).
async function handleCorrectionNotify(body, env) {
  const correctionId = cleanValue(body?.correction_id);
  const status = body?.correction_status === 'applied' ? 'applied' : 'manual';

  const record = await env.SERVICE_MENU_KV.get(`hmu_correction_request:${correctionId}`, { type: 'json' }).catch(() => null);
  if (!record) {
    return jsonResponse({ ok: false, error: 'Correction request not found' }, 404);
  }
  if (record.notified_at) {
    return jsonResponse({ ok: true, idempotent: true, correction_id: correctionId });
  }

  const order = record.order_id
    ? await env.SERVICE_MENU_KV.get(`hmu_order:${record.order_id}`, { type: 'json' }).catch(() => null)
    : null;
  const customerEmail = order?.customer_email || '';
  const lang = record.lang === 'es' ? 'es' : 'en';
  const baseUrl = (env.PUBLIC_BOOK_BASE_URL || 'https://www.hmulink.com').trim();
  const pageUrl = `${baseUrl}/links/${record.slug}/`;
  const buyUrl = buyCorrectionUrl(env, record.slug);

  if (customerEmail) {
    try {
      if (status === 'applied') {
        await sendEmail({
          env,
          to: customerEmail,
          subject: lang === 'es'
            ? '✅ Tu página HMU Link fue actualizada'
            : '✅ Your HMU Link page was updated',
          html: buildCorrectionAppliedEmail({ pageUrl, lang, buyUrl }),
          text: buildCorrectionAppliedText({ pageUrl, lang, buyUrl })
        });
      } else {
        await sendEmail({
          env,
          to: customerEmail,
          subject: lang === 'es'
            ? 'Recibimos tu corrección — la aplicamos en 1 día hábil'
            : 'We received your correction — applying it within 1 business day',
          html: buildCorrectionManualEmail({ pageUrl, lang }),
          text: buildCorrectionManualText({ pageUrl, lang })
        });
      }
    } catch (err) {
      console.error('correction notify email failed:', safeError(err));
      return jsonResponse({ ok: false, error: 'Failed to send correction email' }, 500);
    }
  }

  if (status === 'manual') {
    await notifyAdmin(env, `⚠️ HMU corrección MANUAL pendiente — ${record.slug}`, [
      'La corrección automática no se pudo aplicar; hay que hacerla a mano.',
      `Página: ${pageUrl}`,
      `correction_id: ${correctionId}`,
      '',
      'Cambios pedidos por el cliente:',
      record.changes || '(sin texto)',
      '',
      'Cómo aplicarla: editar data/clients/' + record.slug + '.client.json,',
      'regenerar con generator/generate_service_menu.py --client y pushear.'
    ]);
  }

  try {
    record.status = status;
    record.notified_at = new Date().toISOString();
    await env.SERVICE_MENU_KV.put(`hmu_correction_request:${correctionId}`, JSON.stringify(record), { expirationTtl: 7776000 });
  } catch (err) {
    console.error('correction request update failed:', safeError(err));
  }

  return jsonResponse({ ok: true, correction_id: correctionId, status });
}

// Aviso interno a Verónica (REPLY_TO_EMAIL). Nunca lanza: un fallo de correo
// interno no debe romper el flujo del cliente.
async function notifyAdmin(env, subject, lines) {
  const to = (env.REPLY_TO_EMAIL || '').trim();
  if (!to) return;
  const text = lines.join('\n');
  try {
    await sendEmail({
      env,
      to,
      subject,
      html: `<pre style="font-family: monospace; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
      text
    });
  } catch (err) {
    console.error('admin notify failed:', safeError(err));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function validateStripeSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;

  try {
    // Stripe header: "t=<ts>,v1=<sig>[,v1=<sig>...]". Parse by key, not by
    // position, and collect every v1 (Stripe may send more than one).
    let timestamp = '';
    const v1Signatures = [];
    for (const part of signatureHeader.split(',')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === 't') timestamp = v;
      else if (k === 'v1') v1Signatures.push(v);
    }
    if (!timestamp || v1Signatures.length === 0) return false;

    // Reject signatures outside a 5-minute tolerance to bound replay of a
    // captured, validly-signed request. Stripe re-signs with a fresh timestamp
    // on every delivery (including manual "Resend"), so this never blocks
    // legitimate deliveries.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const signedContent = `${timestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expectedSignature = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return v1Signatures.some((s) => timingSafeEqual(s, expectedSignature));
  } catch {
    return false;
  }
}

async function verifyTallySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;

  try {
    let normalizedBody;
    try {
      normalizedBody = JSON.stringify(JSON.parse(rawBody));
    } catch {
      normalizedBody = rawBody;
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalizedBody));
    const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return timingSafeEqual(expectedBase64, signatureHeader.trim());
  } catch {
    return false;
  }
}

async function dispatchGitHubAction(env, payload) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO not configured');
  }

  const repo = env.GITHUB_REPO;
  const eventType = env.GITHUB_ACTIONS_EVENT || 'new-hmu-service-menu';

  const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      // GitHub API rechaza con 403 cualquier request sin User-Agent.
      'User-Agent': 'service-menu-worker'
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub dispatch failed: ${response.status} ${response.statusText}`);
  }
}

async function checkRateLimit(env, key, limit, ttl) {
  const current = await env.SERVICE_MENU_KV.get(key, { type: 'json' }).catch(() => null);
  const count = (current?.count || 0) + 1;

  if (count > limit) return false;

  await env.SERVICE_MENU_KV.put(key, JSON.stringify({ count }), { expirationTtl: ttl }).catch(() => {});
  return true;
}

async function sendEmail({ env, to, subject, html, text }) {
  if (!env.SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY not configured');
  }

  const fromRaw = env.FROM_EMAIL || 'HMU Link <hello@hmulink.com>';
  const fromEmail = fromRaw.split('<').pop().replace('>', '').trim();
  // Display name del remitente: sin él, los clientes ven "hello" a secas y
  // los filtros de spam desconfían más.
  const fromName = fromRaw.includes('<') ? fromRaw.split('<')[0].trim() : 'HMU Link';
  // hello@hmulink.com no es un buzón real: las respuestas del cliente
  // (incluida la solicitud de corrección gratuita) deben llegar a un correo
  // monitoreado, no rebotar.
  const replyTo = (env.REPLY_TO_EMAIL || '').trim();

  const body = {
    personalizations: [
      {
        to: [{ email: to }],
        subject
      }
    ],
    from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
    // Multipart text/plain + text/html mejora deliverability (HTML-only es
    // señal clásica de spam). SendGrid exige text/plain ANTES de text/html.
    content: [
      ...(text ? [{ type: 'text/plain', value: text }] : []),
      { type: 'text/html', value: html }
    ]
  };
  if (replyTo) {
    body.reply_to = { email: replyTo };
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status}`);
  }

  // SendGrid responds 202 with an empty body — nothing to parse.
  return { ok: true, status: response.status };
}

// Normalización de payload Tally — copiada del patrón probado de MyGuest.
// Tally envía data.fields[] con {key, label, type, value}; los hidden fields
// prefilled por URL llegan como fields con label "order_id". El objeto answers
// se indexa por key, label, title e id, más versiones normalizadas de cada uno.
function normalizeTallyPayload(payload) {
  const submissionId =
    payload?.id ||
    payload?.submission_id ||
    payload?.submissionId ||
    payload?.responseId ||
    payload?.data?.id ||
    payload?.data?.submission_id ||
    payload?.data?.submissionId ||
    payload?.data?.responseId ||
    null;

  const answers = {};

  copyTopLevelAnswers(answers, payload);

  if (payload?.data?.hiddenFields && typeof payload.data.hiddenFields === 'object' && !Array.isArray(payload.data.hiddenFields)) {
    copyAnswerObject(answers, payload.data.hiddenFields);
  }

  const fields =
    Array.isArray(payload?.data?.fields) ? payload.data.fields :
    Array.isArray(payload?.fields) ? payload.fields :
    [];

  for (const field of fields) {
    const value = extractTallyFieldValue(field);
    const keys = [field?.key, field?.name, field?.label, field?.title, field?.id].filter(Boolean);
    for (const key of keys) {
      answers[String(key)] = value;
      answers[normalizeKey(String(key))] = value;
    }
  }

  return {
    submission_id: String(submissionId || ''),
    form_id: String(payload?.data?.formId || payload?.formId || ''),
    answers
  };
}

function copyAnswerObject(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
    target[normalizeKey(key)] = value;
  }
}

function copyTopLevelAnswers(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  const reservedKeys = new Set([
    'id', 'submission_id', 'submissionId', 'responseId',
    'submitted_at', 'submittedAt', 'createdAt', 'data', 'answers', 'fields'
  ]);
  for (const [key, value] of Object.entries(source)) {
    if (reservedKeys.has(key)) continue;
    target[key] = value;
    target[normalizeKey(key)] = value;
  }
}

// Tally Multiple Choice manda IDs de opción; aquí se convierten al texto real.
function extractTallyFieldValue(field) {
  if (!field || typeof field !== 'object') return field;

  const rawValue =
    'value' in field ? field.value :
    'answer' in field ? field.answer :
    'answers' in field ? field.answers :
    'text' in field ? field.text :
    null;

  if (Array.isArray(rawValue) && Array.isArray(field.options)) {
    const selectedTexts = rawValue
      .map((selectedId) => {
        const option = field.options.find((opt) => opt.id === selectedId);
        return option ? option.text : selectedId;
      })
      .filter(Boolean);
    if (selectedTexts.length === 1) return selectedTexts[0];
    return selectedTexts;
  }

  if (typeof rawValue === 'string' && Array.isArray(field.options)) {
    const option = field.options.find((opt) => opt.id === rawValue);
    return option ? option.text : rawValue;
  }

  return rawValue;
}

function getAnswer(answers, key) {
  if (!answers || typeof answers !== 'object') return undefined;
  if (key in answers) return answers[key];
  const normalizedKey = normalizeKey(key);
  if (normalizedKey in answers) return answers[normalizedKey];
  return undefined;
}

function normalizeKey(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function answerAny(answers, keys) {
  for (const k of keys) {
    const v = getAnswer(answers, k);
    if (Array.isArray(v)) {
      const joined = v.map((x) => cleanValue(x)).filter(Boolean).join(', ');
      if (joined) return joined;
      continue;
    }
    const cleaned = cleanValue(v);
    if (cleaned) return cleaned;
  }
  return '';
}

// Fallback for a handful of business-type fields (class schedule / tour details /
// pet notes) whose exact Tally wording varies across the ES and EN forms, so an
// exhaustive alias list is fragile. Each entry in tokenSets is a list of tokens
// that must ALL appear in a normalized answer key; the first matching, non-empty
// answer wins. Tokens are chosen to be specific enough to avoid false positives
// (e.g. ['class','schedule'] won't match the plain business-hours question).
function answerContains(answers, tokenSets) {
  if (!answers || typeof answers !== 'object') return '';
  for (const tokens of tokenSets) {
    for (const key of Object.keys(answers)) {
      const nk = normalizeKey(key);
      if (!tokens.every((t) => nk.includes(t))) continue;
      const v = answers[key];
      if (Array.isArray(v)) {
        const joined = v.map((x) => cleanValue(x)).filter(Boolean).join(', ');
        if (joined) return joined;
        continue;
      }
      const cleaned = cleanValue(v);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

// Tally FILE_UPLOAD fields arrive as an array of { url, name, mimeType, ... }.
// Only the first file is used for single-file fields (logo / main photo).
function answerFileUrl(answers, keys) {
  for (const k of keys) {
    const v = getAnswer(answers, k);
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (first && typeof first === 'object' && typeof first.url === 'string') return first.url;
      if (typeof first === 'string' && first.trim()) return first.trim();
    }
  }
  return '';
}

function answerFileUrls(answers, keys, limit = 6) {
  for (const k of keys) {
    const v = getAnswer(answers, k);
    if (!Array.isArray(v) || v.length === 0) continue;
    return v
      .map((item) => {
        if (item && typeof item === 'object' && typeof item.url === 'string') return item.url.trim();
        if (typeof item === 'string') return item.trim();
        return '';
      })
      .filter(Boolean)
      .slice(0, limit);
  }
  return [];
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function normalizePrimaryCta(value) {
  const normalized = normalizeKey(value);
  const aliases = {
    wa: 'whatsapp',
    wpp: 'whatsapp',
    whats: 'whatsapp',
    whatsapp: 'whatsapp',
    telefono: 'phone',
    phone: 'phone',
    phone_call: 'phone',
    call: 'phone',
    llamar: 'phone',
    llamada_telefonica: 'phone',
    booking: 'booking',
    book: 'booking',
    reservation: 'booking',
    reservas: 'booking',
    reservar: 'booking',
    external_booking_link: 'booking',
    enlace_externo_de_reservas: 'booking',
    website: 'website',
    web: 'website',
    sitio_web: 'website',
    site: 'website',
    tiktok: 'tiktok',
    tik_tok: 'tiktok',
    tt: 'tiktok',
    instagram: 'instagram',
    ig: 'instagram',
    insta: 'instagram',
    facebook: 'facebook',
    fb: 'facebook',
    face: 'facebook',
    email: 'email',
    mail: 'email',
    correo: 'email',
    other: 'other',
    otro: 'other',
    other_public_link: 'other',
    otro_enlace_publico: 'other',
    external_link: 'other',
    enlace_externo: 'other',
    maps: 'maps',
    map: 'maps',
    google_maps: 'maps',
    directions: 'maps',
    google_maps_directions: 'maps',
    google_maps_como_llegar: 'maps',
    como_llegar: 'maps',
    mapa: 'maps'
  };
  return aliases[normalized] || '';
}

// Mapea las respuestas del intake (formularios EN yPkN5X y ES MeyDpk) al
// payload público que consume el generador. SOLO campos públicos aprobados:
// los datos internos (nombre de contacto, teléfono privado, notas "keep off")
// se quedan en KV y nunca se despachan a GitHub Actions.
function buildHmuPublicPayload(normalized, orderId) {
  const a = normalized.answers;

  const styleRaw = answerAny(a, ['pick_your_style', 'elige_tu_estilo']);
  const styleName = styleRaw.split(/[—–-]/)[0] || '';
  let brandStyle = slugify(styleName);
  let styleUnmapped = false;
  if (!VALID_BRAND_STYLES.includes(brandStyle)) {
    styleUnmapped = true;
    brandStyle = 'warm-sand';
  }

  const langRaw = answerAny(a, [
    'which_language_should_your_hmu_link_show_first',
    'en_que_idioma_debe_aparecer_primero_tu_hmu_link'
  ]).toLowerCase();
  let defaultLanguage;
  if (langRaw.includes('espa') || langRaw.includes('span')) defaultLanguage = 'es';
  else if (langRaw.includes('engl') || langRaw.includes('ingl')) defaultLanguage = 'en';
  else defaultLanguage = normalized.form_id === 'MeyDpk' ? 'es' : 'en';

  const businessName = answerAny(a, ['business_name', 'nombre_del_negocio']);
  const suffix = String(normalized.submission_id || orderId || '')
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(-7) || 'x0';
  const publicSlug = `${slugify(businessName) || 'hmu-page'}-${suffix}`;

  return {
    public_slug: publicSlug,
    default_language: defaultLanguage,
    brand_style: brandStyle,
    style_unmapped: styleUnmapped,
    business_name: businessName,
    business_type: answerAny(a, [
      'business_type',
      'type_of_business',
      'what_type_of_business_is_this',
      'what_type_of_business_do_you_have',
      'tipo_de_negocio',
      'que_tipo_de_negocio_es',
      'cual_es_tu_tipo_de_negocio'
    ]),
    short_description: answerAny(a, [
      'describe_your_business_in_1_2_sentences',
      'describe_tu_negocio_en_1_2_frases'
    ]),
    whatsapp: answerAny(a, ['public_whatsapp_number_for_clients', 'whatsapp_publico_para_tus_clientes']),
    phone: answerAny(a, ['public_phone_number_for_calls', 'telefono_publico_para_llamadas']),
    public_email: answerAny(a, ['public_email', 'correo_publico']),
    instagram: answerAny(a, ['instagram']),
    facebook: answerAny(a, ['facebook']),
    tiktok: answerAny(a, ['tiktok']),
    website: answerAny(a, ['website', 'sitio_web']),
    other_public_link: answerAny(a, ['other_public_link', 'otro_enlace_publico']),
    delivery_pickup_links_text: answerAny(a, [
      'delivery_pickup_links',
      'delivery_or_pickup_links',
      'links_for_delivery_or_pickup',
      'links_de_delivery_pickup',
      'links_de_delivery_o_pickup',
      'enlaces_de_delivery_o_pickup'
    ]),
    portfolio_link: answerAny(a, ['portfolio_link', 'portfolio_url', 'enlace_de_portafolio', 'link_de_portafolio']),
    booking_url: answerAny(a, ['external_booking_link', 'enlace_externo_de_reservas']),
    primary_cta: normalizePrimaryCta(answerAny(a, [
      'featured_button',
      'primary_button',
      'main_button',
      'preferred_button',
      'highlight_button',
      'call_to_action_button',
      'which_button_should_be_featured',
      'which_button_should_stand_out_on_your_page',
      'which_button_should_be_the_main_button',
      'which_one_should_be_the_main_button',
      'boton_destacado',
      'boton_principal',
      'boton_a_destacar',
      'que_boton_quieres_destacar',
      'que_boton_debe_destacar',
      'que_boton_debe_ser_el_principal',
      'cual_debe_ser_el_boton_principal'
    ])),
    google_maps_url: answerAny(a, ['location_1_google_maps_link', 'ubicacion_1_enlace_de_google_maps']),
    google_reviews_url: answerAny(a, ['google_reviews_link', 'enlace_de_google_reviews']),
    address: answerAny(a, ['location_1_public_address', 'ubicacion_1_direccion_publica']),
    location_1_notes: answerAny(a, ['location_1_notes', 'ubicacion_1_notas']),
    service_area_text: answerAny(a, ['where_do_you_offer_your_services', 'donde_ofreces_tus_servicios']),
    client_care_text: answerAny(a, [
      'how_do_you_serve_your_clients',
      'how_do_you_work_with_clients',
      'how_do_you_attend_to_your_clients',
      'como_atiendes_a_tus_clientes'
    ]),
    reservations_text: answerAny(a, [
      'do_you_accept_reservations',
      'do_you_accept_bookings',
      'accept_reservations',
      'si_aceptas_reservaciones',
      'aceptas_reservaciones'
    ]),
    class_schedule_text: answerAny(a, [
      'class_schedule',
      'class_timetable',
      'your_class_schedule',
      'horario_de_clases',
      'horario_clases'
    ]) || answerContains(a, [['class', 'schedule'], ['class', 'timetable'], ['horario', 'clase']]),
    tour_details_text: answerAny(a, [
      'tour_details',
      'tour_or_experience_details',
      'details_of_your_tours_or_experiences',
      'details_of_your_tour_or_experience',
      'detalles_de_tus_tours_o_experiencias',
      'detalles_de_tu_tour_o_experiencia',
      'detalles_de_tour'
    ]) || answerContains(a, [['tour'], ['experience', 'detail'], ['experiencia', 'detalle']]),
    pet_notes_text: answerAny(a, [
      'pet_notes',
      'anything_clients_should_know_before_bringing_their_pet',
      'anything_your_clients_should_know_before_bringing_their_pet',
      'before_bringing_your_pet',
      'algo_que_los_clientes_deban_saber_antes_de_traer_a_su_mascota',
      'antes_de_traer_a_su_mascota'
    ]) || answerContains(a, [['pet'], ['mascota']]),
    opening_hours_text: answerAny(a, ['what_are_your_business_hours', 'cuales_son_tus_horarios_de_atencion']),
    service_categories_text: answerAny(a, ['how_do_you_group_your_services', 'como_agrupas_tus_servicios']),
    price_display: answerAny(a, [
      'how_should_prices_appear_on_your_public_page',
      'como_deben_aparecer_los_precios_en_tu_pagina_publica'
    ]),
    services_text: answerAny(a, ['list_your_services_with_prices', 'lista_tus_servicios_con_precios']),
    faq_text: answerAny(a, [
      'faq',
      'frequently_asked_questions',
      'common_questions',
      'questions_your_clients_ask',
      'faq_your_clients_should_see',
      'frequently_asked_questions_your_clients_should_see',
      'preguntas_frecuentes',
      'preguntas_frecuentes_que_tus_clientes_deben_ver',
      'preguntas_que_tus_clientes_hacen',
      'preguntas_y_respuestas_frecuentes'
    ]),
    featured_text: answerAny(a, [
      'featured_package_promo_or_signature_offer',
      'paquete_destacado_promocion_u_oferta_especial'
    ]),
    policies_text: answerAny(a, ['policies_your_clients_should_see', 'politicas_que_tus_clientes_deben_ver']),
    logo_url: answerFileUrl(a, ['upload_your_logo', 'sube_tu_logo']),
    image_url: answerFileUrl(a, ['upload_a_main_photo', 'sube_una_foto_principal']),
    gallery_image_urls: answerFileUrls(a, [
      'more_photos',
      'additional_photos',
      'extra_photos',
      'mas_fotos',
      'fotos_adicionales',
      'fotos_extra'
    ], 5),
    location_1_name: answerAny(a, ['location_1_name', 'ubicacion_1_nombre']),
    location_2_name: answerAny(a, ['location_2_name', 'ubicacion_2_nombre']),
    location_2_address: answerAny(a, ['location_2_public_address', 'ubicacion_2_direccion_publica']),
    location_2_maps_url: answerAny(a, ['location_2_google_maps_link', 'ubicacion_2_enlace_de_google_maps']),
    location_2_notes: answerAny(a, [
      'location_2_phone_whatsapp_or_hours_if_different',
      'ubicacion_2_telefono_whatsapp_u_horarios_si_son_diferentes'
    ]),
    location_3_name: answerAny(a, ['location_3_name', 'ubicacion_3_nombre']),
    location_3_address: answerAny(a, ['location_3_public_address', 'ubicacion_3_direccion_publica']),
    location_3_maps_url: answerAny(a, ['location_3_google_maps_link', 'ubicacion_3_enlace_de_google_maps']),
    location_3_notes: answerAny(a, [
      'location_3_phone_whatsapp_or_hours_if_different',
      'ubicacion_3_telefono_whatsapp_u_horarios_si_son_diferentes'
    ]),
    additional_locations_text: answerAny(a, ['additional_locations', 'ubicaciones_adicionales'])
  };
}

function cleanValue(val) {
  if (!val) return '';
  return String(val).trim();
}

function generateSecureToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let token = '';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (let i = 0; i < array.length; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function safeError(error) {
  if (!error) return '(unknown error)';
  return error.message || String(error);
}

function corsHeaders() {
  // This API is server-to-server only (Stripe, Tally, GitHub Actions) — no
  // browser calls it, so no wildcard is needed. Scope to the site origin
  // instead of '*' to shrink the surface.
  return {
    'Access-Control-Allow-Origin': 'https://www.hmulink.com',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders()
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

// El cuerpo va en el idioma del comprador (lang derivado de la moneda). Un asunto
// en inglés con cuerpo en español (o viceversa) confunde y dispara filtros de spam
// por incongruencia de idioma — el asunto ya se localiza, así que el cuerpo también.
// El correo enlaza AMBOS formularios; el del idioma del comprador va primero.
function buildPostPaymentEmail({ formUrlEN, formUrlES, lang }) {
  const es = lang !== 'en';
  const btnES = `<a href="${formUrlES}" style="display: inline-block; background: #f478b0; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Abrir Formulario (Español)</a>`;
  const btnEN = `<a href="${formUrlEN}" style="display: inline-block; background: #00a0b5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Open Form (English)</a>`;
  const t = es
    ? {
        heading: '¡Tu página de servicios está casi lista!',
        greeting: 'Hola,',
        intro: 'Gracias por tu compra en HMU Link. Solo falta un paso: completa tu formulario de información para que generemos tu página.',
        cta: '📋 Completa tu información:',
        or: 'o',
        firstBtn: btnES,
        secondBtn: btnEN,
        closing: 'Una vez que completes el formulario, generaremos tu página y recibirás un link para compartir con tus clientes.'
      }
    : {
        heading: 'Your service page is almost ready!',
        greeting: 'Hi,',
        intro: 'Thanks for your purchase at HMU Link. Just one step left: fill out your info form so we can generate your page.',
        cta: '📋 Complete your information:',
        or: 'or',
        firstBtn: btnEN,
        secondBtn: btnES,
        closing: "Once you complete the form, we'll generate your page and you'll get a link to share with your customers."
      };
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="margin-top: 0; color: #1a1a1a;">${t.heading}</h2>
    <p>${t.greeting}</p>
    <p>${t.intro}</p>

    <div style="margin: 30px 0;">
      <p style="color: #666; font-size: 14px; margin-bottom: 10px;">${t.cta}</p>
      ${t.firstBtn}
      <p style="margin: 15px 0; color: #999;">${t.or}</p>
      ${t.secondBtn}
    </div>

    <p style="color: #666; font-size: 14px;">${t.closing}</p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; margin: 0;">HMU Link — Service Menus for Small Businesses</p>
  </div>
</body>
</html>
  `;
}

// Versión text/plain del correo post-pago (multipart mejora deliverability).
function buildPostPaymentText({ formUrlEN, formUrlES, lang }) {
  const es = lang !== 'en';
  const lineES = `Completa tu formulario (Español): ${formUrlES}`;
  const lineEN = `Open your form (English): ${formUrlEN}`;
  if (es) {
    return [
      '¡Tu página de servicios está casi lista!',
      '',
      'Gracias por tu compra en HMU Link. Solo falta un paso: completa tu formulario de información para que generemos tu página.',
      '',
      lineES,
      lineEN,
      '',
      'Una vez que completes el formulario, generaremos tu página y recibirás un link para compartir con tus clientes.',
      '',
      'HMU Link — hmulink.com'
    ].join('\n');
  }
  return [
    'Your service page is almost ready!',
    '',
    'Thanks for your purchase at HMU Link. Just one step left: fill out your info form so we can generate your page.',
    '',
    lineEN,
    lineES,
    '',
    "Once you complete the form, we'll generate your page and you'll get a link to share with your customers.",
    '',
    'HMU Link — hmulink.com'
  ].join('\n');
}

// La corrección gratuita se pide con el botón (flujo automatizado /correct/)
// o respondiendo al correo (reply_to va al buzón real) — ambas vías valen.
function buildDeliveryEmail({ pageUrl, slug, lang, correctionUrl }) {
  const es = lang !== 'en';
  const t = es
    ? {
        heading: '¡Tu página de servicios está lista! 🎉',
        greeting: 'Hola,',
        intro: 'Tu página de servicios en HMU Link ha sido generada exitosamente. Aquí está tu link público:',
        label: 'Tu página pública:',
        note: 'Nota: tu página puede tardar unos minutos en estar activa mientras se publica.',
        stepsTitle: 'Próximos pasos:',
        steps: [
          'Abre tu página y verifica que todo se vea correcto',
          'Descarga el código QR desde tu página para compartir fácilmente',
          'Comparte el link en tu bio de Instagram, WhatsApp, tarjetas de visita, etc.'
        ],
        correctionTitle: '✏️ Incluido: Una corrección gratuita',
        correctionBody: 'Si necesitas hacer cambios en tu información (horarios, servicios, precios, etc.), tienes derecho a una corrección gratuita. Pídela con este botón y la aplicamos automáticamente:',
        correctionBtn: 'Solicitar mi corrección',
        correctionAlt: 'También puedes simplemente responder a este correo con los cambios que quieras. Para cambiar fotos o logo, responde a este correo adjuntando los archivos.'
      }
    : {
        heading: 'Your service page is ready! 🎉',
        greeting: 'Hi,',
        intro: 'Your HMU Link service page has been generated successfully. Here is your public link:',
        label: 'Your public page:',
        note: 'Note: your page may take a few minutes to go live while it publishes.',
        stepsTitle: 'Next steps:',
        steps: [
          'Open your page and check that everything looks right',
          'Download the QR code from your page to share it easily',
          'Share the link in your Instagram bio, WhatsApp, business cards, etc.'
        ],
        correctionTitle: '✏️ Included: One free correction',
        correctionBody: 'If you need to change your info (hours, services, prices, etc.), you get one free correction. Request it with this button and we\'ll apply it automatically:',
        correctionBtn: 'Request my correction',
        correctionAlt: 'You can also simply reply to this email with the changes you want. To change photos or your logo, reply to this email with the files attached.'
      };
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="margin-top: 0; color: #1a1a1a;">${t.heading}</h2>
    <p>${t.greeting}</p>
    <p>${t.intro}</p>

    <div style="margin: 30px 0; padding: 20px; background: #f0f8ff; border-left: 4px solid #00a0b5; border-radius: 4px;">
      <p style="margin: 0 0 10px 0; color: #666; font-size: 12px;">${t.label}</p>
      <a href="${pageUrl}" style="display: inline-block; color: #00a0b5; font-size: 18px; font-weight: 500; text-decoration: none; word-break: break-all;">${pageUrl}</a>
    </div>

    <p style="color: #999; font-size: 13px;">${t.note}</p>

    <h3 style="color: #1a1a1a; margin-top: 30px;">${t.stepsTitle}</h3>
    <ul style="color: #666;">
      <li>${t.steps[0]}</li>
      <li>${t.steps[1]}</li>
      <li>${t.steps[2]}</li>
    </ul>

    <div style="margin: 30px 0; padding: 20px; background: #fff9e6; border-left: 4px solid #ffa934; border-radius: 4px;">
      <p style="margin: 0 0 15px 0; color: #333; font-weight: 500;">${t.correctionTitle}</p>
      <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">${t.correctionBody}</p>
      <a href="${correctionUrl}" style="display: inline-block; background: #ffa934; color: #4a2c00; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${t.correctionBtn}</a>
      <p style="margin: 15px 0 0 0; color: #888; font-size: 12px;">${t.correctionAlt}</p>
    </div>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; margin: 0;">HMU Link — Service Menus for Small Businesses</p>
  </div>
</body>
</html>
  `;
}

// Versión text/plain del correo de entrega.
function buildDeliveryText({ pageUrl, lang, correctionUrl }) {
  const es = lang !== 'en';
  if (es) {
    return [
      '¡Tu página de servicios está lista!',
      '',
      `Tu página pública: ${pageUrl}`,
      '',
      'Nota: tu página puede tardar unos minutos en estar activa mientras se publica.',
      '',
      'Próximos pasos:',
      '- Abre tu página y verifica que todo se vea correcto',
      '- Descarga el código QR desde tu página para compartir fácilmente',
      '- Comparte el link en tu bio de Instagram, WhatsApp, tarjetas de visita, etc.',
      '',
      'Incluido: una corrección gratuita. Si necesitas cambios (horarios, servicios, precios, etc.), pídela aquí y la aplicamos automáticamente:',
      correctionUrl,
      'También puedes responder a este correo con los cambios (fotos o logo: adjúntalos en tu respuesta).',
      '',
      'HMU Link — hmulink.com'
    ].join('\n');
  }
  return [
    'Your service page is ready!',
    '',
    `Your public page: ${pageUrl}`,
    '',
    'Note: your page may take a few minutes to go live while it publishes.',
    '',
    'Next steps:',
    '- Open your page and check that everything looks right',
    '- Download the QR code from your page to share it easily',
    '- Share the link in your Instagram bio, WhatsApp, business cards, etc.',
    '',
    'Included: one free correction. If you need changes (hours, services, prices, etc.), request it here and we\'ll apply it automatically:',
    correctionUrl,
    'You can also reply to this email with the changes (photos or logo: attach the files in your reply).',
    '',
    'HMU Link — hmulink.com'
  ].join('\n');
}

// ─── Correos del flujo de correcciones ───────────────────────────────────────

// Cascarón compartido de los correos de corrección (mismo look del resto).
function correctionEmailShell(innerHtml) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    ${innerHtml}
    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; margin: 0;">HMU Link — Service Menus for Small Businesses</p>
  </div>
</body>
</html>
  `;
}

// Corrección aplicada: confirma y ofrece la corrección adicional de pago
// (precio de la sección 3 de los Términos).
function buildCorrectionAppliedEmail({ pageUrl, lang, buyUrl }) {
  const es = lang !== 'en';
  const priceLabel = es ? CORRECTION_PRICE.mxn.label : CORRECTION_PRICE.usd.label;
  const t = es
    ? {
        heading: '✅ Tu página fue actualizada',
        intro: 'Aplicamos los cambios que pediste. Revisa tu página (puede tardar unos minutos en reflejarse):',
        buyTitle: '¿Necesitas otro cambio?',
        buyBody: `Puedes comprar una corrección adicional por ${priceLabel}:`,
        buyBtn: 'Comprar corrección adicional',
        alt: 'Si algo no quedó como esperabas, responde a este correo y lo revisamos sin costo.'
      }
    : {
        heading: '✅ Your page was updated',
        intro: 'We applied the changes you requested. Check your page (it may take a few minutes to refresh):',
        buyTitle: 'Need another change?',
        buyBody: `You can buy an extra correction for ${priceLabel}:`,
        buyBtn: 'Buy an extra correction',
        alt: 'If something didn\'t come out as expected, reply to this email and we\'ll review it at no cost.'
      };
  const buyBlock = buyUrl
    ? `
    <div style="margin: 30px 0; padding: 20px; background: #f0f8ff; border-left: 4px solid #00a0b5; border-radius: 4px;">
      <p style="margin: 0 0 10px 0; color: #333; font-weight: 500;">${t.buyTitle}</p>
      <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">${t.buyBody}</p>
      <a href="${buyUrl}" style="display: inline-block; background: #00a0b5; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${t.buyBtn}</a>
    </div>`
    : '';
  return correctionEmailShell(`
    <h2 style="margin-top: 0; color: #1a1a1a;">${t.heading}</h2>
    <p>${t.intro}</p>
    <p><a href="${pageUrl}" style="color: #00a0b5; font-size: 18px; font-weight: 500; word-break: break-all;">${pageUrl}</a></p>
    ${buyBlock}
    <p style="color: #666; font-size: 14px;">${t.alt}</p>
  `);
}

function buildCorrectionAppliedText({ pageUrl, lang, buyUrl }) {
  const es = lang !== 'en';
  const priceLabel = es ? CORRECTION_PRICE.mxn.label : CORRECTION_PRICE.usd.label;
  const lines = es
    ? [
        'Tu página fue actualizada.',
        '',
        `Revisa tu página (puede tardar unos minutos en reflejarse): ${pageUrl}`,
        '',
        ...(buyUrl ? [`¿Necesitas otro cambio? Compra una corrección adicional por ${priceLabel}: ${buyUrl}`, ''] : []),
        'Si algo no quedó como esperabas, responde a este correo y lo revisamos sin costo.',
        '',
        'HMU Link — hmulink.com'
      ]
    : [
        'Your page was updated.',
        '',
        `Check your page (it may take a few minutes to refresh): ${pageUrl}`,
        '',
        ...(buyUrl ? [`Need another change? Buy an extra correction for ${priceLabel}: ${buyUrl}`, ''] : []),
        'If something didn\'t come out as expected, reply to this email and we\'ll review it at no cost.',
        '',
        'HMU Link — hmulink.com'
      ];
  return lines.join('\n');
}

// La corrección no se pudo aplicar automáticamente: promesa honesta de 1 día
// hábil, sin pedirle nada más al cliente (Verónica ya recibió el detalle).
function buildCorrectionManualEmail({ pageUrl, lang }) {
  const es = lang !== 'en';
  const t = es
    ? {
        heading: 'Recibimos tu corrección ✏️',
        body: 'Estamos aplicando tus cambios personalmente para que queden perfectos. Tu página quedará actualizada dentro de 1 día hábil — no necesitas hacer nada más.',
        label: 'Tu página:'
      }
    : {
        heading: 'We received your correction ✏️',
        body: 'We\'re applying your changes personally to make sure they come out right. Your page will be updated within 1 business day — nothing else is needed from you.',
        label: 'Your page:'
      };
  return correctionEmailShell(`
    <h2 style="margin-top: 0; color: #1a1a1a;">${t.heading}</h2>
    <p>${t.body}</p>
    <p style="color: #666; font-size: 12px; margin-bottom: 4px;">${t.label}</p>
    <p style="margin-top: 0;"><a href="${pageUrl}" style="color: #00a0b5; word-break: break-all;">${pageUrl}</a></p>
  `);
}

function buildCorrectionManualText({ pageUrl, lang }) {
  const es = lang !== 'en';
  return (es
    ? [
        'Recibimos tu corrección.',
        '',
        'Estamos aplicando tus cambios personalmente. Tu página quedará actualizada dentro de 1 día hábil — no necesitas hacer nada más.',
        '',
        `Tu página: ${pageUrl}`,
        '',
        'HMU Link — hmulink.com'
      ]
    : [
        'We received your correction.',
        '',
        'We\'re applying your changes personally. Your page will be updated within 1 business day — nothing else is needed from you.',
        '',
        `Your page: ${pageUrl}`,
        '',
        'HMU Link — hmulink.com'
      ]).join('\n');
}

// Compra de corrección adicional: entrega el enlace con el token nuevo.
function buildCorrectionPurchaseEmail({ formUrl, pageUrl, lang }) {
  const es = lang !== 'en';
  const t = es
    ? {
        heading: '¡Gracias por tu compra! ✏️',
        intro: 'Ya puedes pedir tu corrección adicional. Usa este botón y descríbenos los cambios que quieres en tu página:',
        btn: 'Pedir mi corrección',
        note: 'El enlace es de un solo uso y vence en 30 días. Para cambiar fotos o logo, responde a este correo adjuntando los archivos.',
        label: 'Tu página:'
      }
    : {
        heading: 'Thanks for your purchase! ✏️',
        intro: 'You can now request your extra correction. Use this button and describe the changes you want on your page:',
        btn: 'Request my correction',
        note: 'The link is single-use and expires in 30 days. To change photos or your logo, reply to this email with the files attached.',
        label: 'Your page:'
      };
  return correctionEmailShell(`
    <h2 style="margin-top: 0; color: #1a1a1a;">${t.heading}</h2>
    <p>${t.intro}</p>
    <p style="margin: 25px 0;"><a href="${formUrl}" style="display: inline-block; background: #ffa934; color: #4a2c00; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">${t.btn}</a></p>
    <p style="color: #888; font-size: 13px;">${t.note}</p>
    <p style="color: #666; font-size: 12px; margin-bottom: 4px;">${t.label}</p>
    <p style="margin-top: 0;"><a href="${pageUrl}" style="color: #00a0b5; word-break: break-all;">${pageUrl}</a></p>
  `);
}

function buildCorrectionPurchaseText({ formUrl, pageUrl, lang }) {
  const es = lang !== 'en';
  return (es
    ? [
        '¡Gracias por tu compra!',
        '',
        'Ya puedes pedir tu corrección adicional. Abre este enlace y descríbenos los cambios que quieres:',
        formUrl,
        '',
        'El enlace es de un solo uso y vence en 30 días. Para cambiar fotos o logo, responde a este correo adjuntando los archivos.',
        '',
        `Tu página: ${pageUrl}`,
        '',
        'HMU Link — hmulink.com'
      ]
    : [
        'Thanks for your purchase!',
        '',
        'You can now request your extra correction. Open this link and describe the changes you want:',
        formUrl,
        '',
        'The link is single-use and expires in 30 days. To change photos or your logo, reply to this email with the files attached.',
        '',
        `Your page: ${pageUrl}`,
        '',
        'HMU Link — hmulink.com'
      ]).join('\n');
}
