# QA Checklist: Automated Payment Flow

Use this checklist to verify each component works correctly before going live.

---

## Phase 1: Configuration ✓ (Automated code written)

- [x] Worker code written (`worker/worker.js`)
- [x] wrangler.toml template created
- [x] GitHub Actions workflow created
- [x] Setup instructions documented

---

## Phase 2: Manual Setup (Your steps)

### Stripe Setup
- [ ] Stripe product created (HMU Link Service Menu)
- [ ] Stripe payment link created and tested in test mode
- [ ] Stripe webhook endpoint configured
- [ ] Stripe webhook signing secret copied

### Cloudflare Setup
- [ ] KV namespace created (SERVICE_MENU_KV)
- [ ] KV namespace ID copied to wrangler.toml
- [ ] Worker authenticated (`wrangler login`)
- [ ] All 5 secrets configured via `wrangler secret put`

### Tally Setup
- [ ] Tally webhook endpoint created
- [ ] Tally signing secret obtained and configured
- [ ] Both Tally forms (EN + ES) have order_id field
- [ ] Both Tally forms have customer_email field

### GitHub Setup
- [ ] SERVICE_MENU_WORKER_URL secret added
- [ ] NOTIFY_SECRET secret added

---

## Phase 3: Deployment

- [ ] Worker deployed (`wrangler deploy`)
- [ ] Worker health check passes (`/health` endpoint)
- [ ] GitHub Actions workflow visible in Actions tab

---

## Phase 4: Integration Test (Stripe Test Mode)

### 4.1 Payment Flow
- [ ] Click Stripe payment link
- [ ] Fill test card (4242 4242 4242 4242)
- [ ] Payment succeeds
- [ ] Stripe webhook received (check Stripe Dashboard → Events)

### 4.2 Email Flow
- [ ] Post-payment email received (check test email inbox or spam)
- [ ] Email contains Tally form link
- [ ] Email contains order_id parameter prefilled
- [ ] Email contains customer_email parameter prefilled

### 4.3 Tally Flow
- [ ] Click Tally link from email
- [ ] Form opens with order_id + customer_email prefilled
- [ ] Fill all required fields:
  - [ ] Business name
  - [ ] Service type/category
  - [ ] Services (at least 1)
  - [ ] Hours/opening times
  - [ ] Address
  - [ ] WhatsApp
  - [ ] Google Maps link
  - [ ] Brand style (select one of 12)
- [ ] Submit form
- [ ] Tally webhook sent (check Tally Dashboard → Integrations → Webhooks)

### 4.4 Worker Processing
- [ ] Worker receives Tally webhook
- [ ] Worker validates order_id exists
- [ ] Worker creates submission record in KV
- [ ] Worker dispatches GitHub Actions
- [ ] Check KV keys: `npx wrangler kv key list --remote`
  - [ ] `hmu_order:pi_xxx...` exists with status "intake_received"
  - [ ] `hmu_submission:...` exists with form data

### 4.5 GitHub Actions Generation
- [ ] Check GitHub Actions → Workflows → "Generate HMU Service Menu Page"
- [ ] Job completed successfully
- [ ] Workflow logs show:
  - [ ] "Generate service menu page" passed
  - [ ] "Commit and push generated page" completed
  - [ ] "Trigger delivery notification" sent request
- [ ] Check `public/links/<slug>/` directory exists with `index.html` + `qr.svg`

### 4.6 Delivery Email
- [ ] Delivery email received from hello@hmulink.com
- [ ] Email contains:
  - [ ] Public page URL (https://www.hmulink.com/links/<slug>/)
  - [ ] QR code (scannable, points to same URL)
  - [ ] One-time correction link
- [ ] Page URL clickable and opens page

### 4.7 Public Page
- [ ] Open public page URL
- [ ] Verify all data appears correctly:
  - [ ] Business name correct
  - [ ] Services visible
  - [ ] Hours correct
  - [ ] Address correct
  - [ ] WhatsApp link works
  - [ ] Google Maps link works
  - [ ] No order_id, customer_email, or secrets visible in page source
- [ ] QR code on page is scannable

### 4.8 Correction Flow
- [ ] Click one-time correction link from delivery email
- [ ] Tally correction form opens with order_id + correction_token prefilled
- [ ] Fill correction (e.g., update a service price)
- [ ] Submit correction form
- [ ] Worker marks correction_token as used in KV
- [ ] GitHub Actions triggered again to regenerate page
- [ ] Public page updated with correction
- [ ] Attempt to click correction link again → should get error

### 4.9 Idempotency & Security
- [ ] Trigger same Stripe payment webhook twice (via Stripe webhook replay)
  - [ ] First: order created
  - [ ] Second: idempotent response (no duplicate order)
- [ ] Attempt Tally submission without order_id → rejected (403)
- [ ] Attempt Tally submission with fake order_id → rejected (403)
- [ ] View page source (right-click → View Page Source) → no sensitive data
- [ ] Check browser DevTools Network → no secrets in headers/responses

---

## Phase 5: Live Mode Preparation

- [ ] Stripe switched to Live mode
- [ ] Payment link updated to live product link
- [ ] All secrets updated to live account values:
  - [ ] STRIPE_WEBHOOK_SECRET (live signing secret)
  - [ ] RESEND_API_KEY (live account)
  - [ ] GITHUB_TOKEN (still same, or new live-scoped token)
  - [ ] TALLY_SIGNING_SECRET (still same, or new webhook)
- [ ] GitHub Actions secrets updated (if URLs change)
- [ ] One final live test with small transaction ($1-$5)

---

## Phase 6: Post-Launch Monitoring

- [ ] Monitor Worker logs for errors: https://dash.cloudflare.com/?to=/:account/workers
- [ ] Monitor KV quota usage (dashboard → Workers → KV → Storage)
- [ ] Monitor Resend email delivery: https://resend.com/emails
- [ ] Check GitHub Actions runs for any failures
- [ ] Verify customer feedback (page correct, emails received, etc.)

---

## Sign-Off

- [ ] All checkboxes completed
- [ ] Tested with at least one live test payment
- [ ] Team awareness of operational runbook (if applicable)
- [ ] Ready for first real customer! 🎉

---

## Troubleshooting Quick Links

If any step fails:

1. **Worker not starting**: Check `wrangler deploy` output for errors
2. **Webhook not received**: Verify endpoint URL in Stripe/Tally Dashboard matches Worker route
3. **Signature validation failed**: Verify secrets are correct (compare against Dashboard)
4. **GitHub Actions not triggered**: Check GITHUB_TOKEN scope (needs `repo` + `workflow`)
5. **Email not sent**: Verify RESEND_API_KEY and FROM_EMAIL is verified sender
6. **Page not generated**: Check Python script runs locally (`python generator/generate_service_menu.py --help`)
7. **KV writes failing**: Verify namespace ID in wrangler.toml matches actual namespace

Refer to `docs/SETUP_AUTOMATED_PAYMENT_FLOW.md` for detailed setup steps.
