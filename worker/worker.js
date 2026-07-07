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
 * 5. GitHub Actions calls /notify → send delivery email
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
 */

const VALID_BRAND_STYLES = [
  'black-gold', 'soft-blush', 'charcoal-clean', 'warm-sand',
  'aqua-clean', 'sage-calm', 'electric-slate', 'terracotta-warm',
  'sunny-paws', 'midnight-ink', 'clarity-editorial', 'horizon-teal'
];

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

  // Product filter: the Stripe account is shared with other products (MyGuest),
  // so every webhook receives every sale. Only checkout.session.completed
  // carries payment_link; payment_intent.succeeded can't be attributed to a
  // product, so it's ignored when the filter is configured.
  const expectedPaymentLink = (env.STRIPE_PAYMENT_LINK_ID || '').trim();
  if (expectedPaymentLink) {
    if (type !== 'checkout.session.completed') {
      return jsonResponse({ ok: true, ignored: true, reason: 'unattributable_event_type' });
    }
    if ((session.payment_link || '') !== expectedPaymentLink) {
      return jsonResponse({ ok: true, ignored: true, reason: 'other_product' });
    }
  } else if (type === 'checkout.session.completed') {
    // Filter not configured yet — log the plink id so it can be captured.
    console.log('stripe payment_link observed:', session.payment_link || '(none)');
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

  // Send post-payment email
  try {
    await sendEmail({
      env,
      to: customerEmail,
      subject: 'Complete your HMU Link service menu — one form to go',
      html: buildPostPaymentEmail({ formUrlEN, formUrlES })
    });
  } catch (err) {
    console.error('post-payment email failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to send post-payment email' }, 500);
  }

  // Mark as processed
  await env.SERVICE_MENU_KV.put(processedKey, '1', { expirationTtl: 604800 });

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

  // Handle corrections (form_type: corrections)
  const formType = cleanValue(getAnswer(normalized.answers, 'form_type')) || '';
  if (formType === 'corrections') {
    return await handleCorrectionsSubmission(normalized, env);
  }

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

  const hasContact = publicPayload.whatsapp || publicPayload.phone || publicPayload.public_email || publicPayload.booking_url;
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

  // Save correction token
  try {
    await env.SERVICE_MENU_KV.put(`hmu_correction:${correctionToken}`, JSON.stringify({
      correction_token: correctionToken,
      order_id: orderId,
      slug,
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

  try {
    await sendEmail({
      env,
      to: customerEmail,
      subject: 'Your HMU Link service menu is ready! 🎉',
      html: buildDeliveryEmail({
        pageUrl,
        slug
      })
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
// CORRECTIONS HANDLER
// ─────────────────────────────────────────────────────────────────────────────

async function handleCorrectionsSubmission(normalized, env) {
  const correctionToken = cleanValue(getAnswer(normalized.answers, 'correction_token')) || '';
  const orderId = cleanValue(getAnswer(normalized.answers, 'order_id')) || '';

  if (!correctionToken || !orderId) {
    return jsonResponse({ ok: false, error: 'Missing correction_token or order_id' }, 400);
  }

  const correctionRecord = await env.SERVICE_MENU_KV.get(`hmu_correction:${correctionToken}`, { type: 'json' }).catch(() => null);
  if (!correctionRecord) {
    return jsonResponse({ ok: false, error: 'Invalid correction token' }, 403);
  }

  if (correctionRecord.used_at) {
    return jsonResponse({ ok: false, error: 'Correction token already used' }, 403);
  }

  if (correctionRecord.order_id !== orderId) {
    return jsonResponse({ ok: false, error: 'Order mismatch for correction' }, 403);
  }

  const slug = correctionRecord.slug;

  // Mark token as used
  try {
    correctionRecord.used_at = new Date().toISOString();
    await env.SERVICE_MENU_KV.put(`hmu_correction:${correctionToken}`, JSON.stringify(correctionRecord));
  } catch (err) {
    console.error('correction token update failed:', safeError(err));
  }

  // Dispatch GitHub Actions to regenerate page with corrections.
  // OJO: NO incluir order_id en client_payload — GitHub imprime el env de
  // cada step en logs públicos (misma regla que el flujo principal); el
  // order_id se resuelve desde KV vía correction_token cuando haga falta.
  try {
    await dispatchGitHubAction(env, {
      submission_id: normalized.submission_id,
      is_correction: true,
      correction_token: correctionToken
    });
  } catch (err) {
    console.error('github dispatch for correction failed:', safeError(err));
    return jsonResponse({ ok: false, error: 'Failed to dispatch correction' }, 500);
  }

  return jsonResponse({
    ok: true,
    message: 'Correction received. Your page will be updated shortly.',
    slug
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function validateStripeSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;

  try {
    const [timestamp, signature] = signatureHeader.split(',').map(s => {
      const [k, v] = s.split('=');
      return v;
    });

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

    return timingSafeEqual(signature, expectedSignature);
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

async function sendEmail({ env, to, subject, html }) {
  if (!env.SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY not configured');
  }

  const fromEmail = (env.FROM_EMAIL || 'hello@hmulink.com').split('<').pop().replace('>', '').trim();
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
    from: { email: fromEmail },
    content: [
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

// Tally FILE_UPLOAD fields arrive as an array of { url, name, mimeType, ... }.
// Only the first file is used (logo / main photo are single-file fields).
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
    call: 'phone',
    llamar: 'phone',
    booking: 'booking',
    book: 'booking',
    reservation: 'booking',
    reservas: 'booking',
    reservar: 'booking',
    website: 'website',
    web: 'website',
    sitio_web: 'website',
    site: 'website',
    email: 'email',
    mail: 'email',
    correo: 'email'
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
      'boton_destacado',
      'boton_principal',
      'boton_a_destacar',
      'que_boton_quieres_destacar',
      'que_boton_debe_destacar',
      'que_boton_debe_ser_el_principal'
    ])),
    google_maps_url: answerAny(a, ['location_1_google_maps_link', 'ubicacion_1_enlace_de_google_maps']),
    google_reviews_url: answerAny(a, ['google_reviews_link', 'enlace_de_google_reviews']),
    address: answerAny(a, ['location_1_public_address', 'ubicacion_1_direccion_publica']),
    opening_hours_text: answerAny(a, ['what_are_your_business_hours', 'cuales_son_tus_horarios_de_atencion']),
    services_text: answerAny(a, ['list_your_services_with_prices', 'lista_tus_servicios_con_precios']),
    featured_text: answerAny(a, [
      'featured_package_promo_or_signature_offer',
      'paquete_destacado_promocion_u_oferta_especial'
    ]),
    policies_text: answerAny(a, ['policies_your_clients_should_see', 'politicas_que_tus_clientes_deben_ver']),
    logo_url: answerFileUrl(a, ['upload_your_logo', 'sube_tu_logo']),
    image_url: answerFileUrl(a, ['upload_a_main_photo', 'sube_una_foto_principal']),
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
    ])
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
  return {
    'Access-Control-Allow-Origin': '*',
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

function buildPostPaymentEmail({ formUrlEN, formUrlES }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="margin-top: 0; color: #1a1a1a;">¡Tu página de servicios está casi lista!</h2>
    <p>Hola,</p>
    <p>Gracias por tu compra en HMU Link. Solo falta un paso: completa tu formulario de información para que generemos tu página.</p>

    <div style="margin: 30px 0;">
      <p style="color: #666; font-size: 14px; margin-bottom: 10px;">📋 Completa tu información:</p>
      <a href="${formUrlES}" style="display: inline-block; background: #f478b0; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Abrir Formulario (Español)</a>
      <p style="margin: 15px 0; color: #999;">o</p>
      <a href="${formUrlEN}" style="display: inline-block; background: #00a0b5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Open Form (English)</a>
    </div>

    <p style="color: #666; font-size: 14px;">Una vez que completes el formulario, generaremos tu página y recibirás un link para compartir con tus clientes.</p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; margin: 0;">HMU Link — Service Menus for Small Businesses</p>
  </div>
</body>
</html>
  `;
}

// La corrección gratuita se pide respondiendo al correo (reply_to va al buzón
// real). El flujo automatizado con correction_token queda para v2 — el token
// se sigue generando y guardando en KV para cuando exista.
function buildDeliveryEmail({ pageUrl, slug }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="margin-top: 0; color: #1a1a1a;">¡Tu página de servicios está lista! 🎉</h2>
    <p>Hola,</p>
    <p>Tu página de servicios en HMU Link ha sido generada exitosamente. Aquí está tu link público:</p>

    <div style="margin: 30px 0; padding: 20px; background: #f0f8ff; border-left: 4px solid #00a0b5; border-radius: 4px;">
      <p style="margin: 0 0 10px 0; color: #666; font-size: 12px;">Tu página pública:</p>
      <a href="${pageUrl}" style="display: inline-block; color: #00a0b5; font-size: 18px; font-weight: 500; text-decoration: none; word-break: break-all;">${pageUrl}</a>
    </div>

    <p style="color: #999; font-size: 13px;">Nota: tu página puede tardar unos minutos en estar activa mientras se publica.</p>

    <h3 style="color: #1a1a1a; margin-top: 30px;">Próximos pasos:</h3>
    <ul style="color: #666;">
      <li>Abre tu página y verifica que todo se vea correcto</li>
      <li>Descarga el código QR desde tu página para compartir fácilmente</li>
      <li>Comparte el link en tu bio de Instagram, WhatsApp, tarjetas de visita, etc.</li>
    </ul>

    <div style="margin: 30px 0; padding: 20px; background: #fff9e6; border-left: 4px solid #ffa934; border-radius: 4px;">
      <p style="margin: 0 0 15px 0; color: #333; font-weight: 500;">✏️ Incluido: Una corrección gratuita</p>
      <p style="margin: 0; color: #666; font-size: 14px;">Si necesitas hacer cambios en tu información (horarios, servicios, precios, etc.), tienes derecho a una corrección gratuita: <strong>simplemente responde a este correo</strong> con los cambios que quieras y los aplicamos por ti.</p>
    </div>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; margin: 0;">HMU Link — Service Menus for Small Businesses</p>
  </div>
</body>
</html>
  `;
}
