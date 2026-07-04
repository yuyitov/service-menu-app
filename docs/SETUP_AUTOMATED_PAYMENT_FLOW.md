# Setup: Automated Payment Flow for HMU Link

**Estado:** Código del Worker escrito ✓ | Instrucciones de setup completas (este documento)

Este documento te guía paso a paso para **activar el flujo automatizado completo** de HMU Link:

```
Stripe Payment → Email con Tally link → Submission → GitHub Actions → Page → Delivery email
```

**Tiempo total:** ~30-45 minutos

---

## Paso 1: Create Stripe Product + Webhook Secret

### 1.1 Create HMU Link Product

1. Ve a **Stripe Dashboard**: https://dashboard.stripe.com/
2. Click **Products** (en el sidebar)
3. Click **Add product**
4. Rellena:
   - **Name**: `HMU Link Service Menu — Founder`
   - **Description**: `One digital service menu page + 1 free correction + QR code`
   - **Price**: 
     - **USD**: $39 (para mercado USA/Canadá)
     - **MXN**: $699 (para mercado México, o crea dos productos, uno por moneda)
   - **Billing period**: One-time (no recurring)
5. Click **Save product**

### 1.2 Create Payment Link

1. En el mismo producto, click **Create payment link**
2. Rellena:
   - **Line items**: Select product you just created
   - **Customer information**: Check "Email"
   - **Success behavior**: 
     - Option: "Redirect to URL"
     - URL: `https://www.hmulink.com/` (o tu landing page)
     - Alternativamente: "Show confirmation message"
   - **Cancel behavior**: Default is fine (redirect to cancel URL)
3. Click **Create link**
4. **Copy the payment link URL** — vai aquí:
   - `https://buy.stripe.com/...` (un string largo)
5. **Guard this link** — esta es tu URL de pago pública

### 1.3 Get Webhook Signing Secret

1. En Stripe Dashboard, click **Developers** (top-right)
2. Click **Webhooks**
3. Click **Add endpoint**
4. Rellena:
   - **Endpoint URL**: `https://service-menu-worker.veronica-perezarroyo.workers.dev/stripe/webhook`
   - **Events to send**:
     - Select **checkout.session.completed**
     - (Optional: also select **payment_intent.succeeded**)
5. Click **Add endpoint**
6. Verás un signing secret tipo `whsec_1234567890abcdef...`
7. Click **Reveal** y **copy the full secret** — lo usarás en Paso 4

---

## Paso 3: Create KV Namespace in Cloudflare

### 3.1 Create Namespace

1. Ve a **Cloudflare Dashboard**: https://dash.cloudflare.com/
2. Click **Workers & Pages** (en sidebar)
3. Click **KV**
4. Click **Create a namespace**
5. Name: `SERVICE_MENU_KV`
6. Click **Add namespace**
7. Verás el namespace creado con un **ID** tipo `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
8. **Copy the ID** — lo usarás en Paso 4

---

## Paso 4: Configure Worker Secrets + Variables

Ahora que tienes Stripe webhook secret y KV namespace ID, configura el Worker.

### 4.1 Update wrangler.toml with KV namespace ID

1. Abre `worker/wrangler.toml`
2. Busca esta línea:
   ```toml
   id      = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
   ```
3. Reemplaza con tu KV namespace ID del Paso 3:
   ```toml
   id      = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```
4. **Save** el archivo

### 4.2 Configure Secrets in Cloudflare

First, authenticate with Cloudflare locally:

```bash
cd worker/
npx wrangler login
```

Then set the secrets. Run each command separately:

```bash
# Stripe webhook secret (de Paso 1.3)
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# Tally signing secret (obtendrás en Paso 5)
npx wrangler secret put TALLY_SIGNING_SECRET

# GitHub Personal Access Token (necesita scope: repo, workflow)
npx wrangler secret put GITHUB_TOKEN

# Resend API Key (https://resend.com/api-keys)
npx wrangler secret put RESEND_API_KEY

# Notification secret (genera uno random, usa para /notify endpoint)
# Genera: openssl rand -base64 32  (o en Windows: certutil -randomize | find "Random")
npx wrangler secret put NOTIFY_SECRET
```

Cuando ejecutes cada comando, se abrirá un prompt pidiendo el valor. Pégalo y presiona Enter.

---

## Paso 5: Configure Tally Webhooks

### 5.1 Get Tally Signing Secret

1. Ve a **Tally.so**: https://tally.so/
2. Login a tu account
3. Click tu **Workspace** (dropdown arriba)
4. Click **Settings** → **Integrations** → **Webhooks**
5. Click **+ Create a webhook**
6. Rellena:
   - **Endpoint URL**: `https://service-menu-worker.veronica-perezarroyo.workers.dev/tally-webhook`
   - **Events**: Select all relevant (form submissions, updates, etc.)
7. Click **Create webhook**
8. Verás un **Signing Secret** tipo `sk_live_1234567890abcdef...`
9. **Copy the full signing secret**
10. Corre en terminal:
    ```bash
    cd worker/
    npx wrangler secret put TALLY_SIGNING_SECRET
    ```
    Pega el signing secret y presiona Enter

### 5.2 Verify both Tally forms have order_id field

En Tally.so, abre ambos formularios (EN: yPkN5X, ES: MeyDpk) y **verifica** que incluyan estos campos:

- **order_id** (hidden or visible, preferably prefilled from URL param)
- **customer_email** (text, prefilled from URL param)
- **All service menu fields** (business_name, services, hours, etc.)

Si faltan campos, agrégalos en Tally.

---

## Paso 6 (Automatizado): Deploy Worker + GitHub Actions

Once all secrets are configured, the Worker is ready to deploy.

### 6.1 Deploy Worker

```bash
cd worker/
npx wrangler deploy
```

Output debe mostrar:
```
✓ Uploaded service-menu-worker (XYZ KB)
✓ Published to https://service-menu-worker.veronica-perezarroyo.workers.dev
```

### 6.2 Test Worker Health

```bash
curl https://service-menu-worker.veronica-perezarroyo.workers.dev/health
```

Debe responder:
```json
{"ok": true, "worker": "service-menu-worker"}
```

### 6.3 Configure GitHub Actions Secrets

En GitHub, ve a your repo:

1. **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Agrega:
   - **Name**: `SERVICE_MENU_WORKER_URL`
   - **Value**: `https://service-menu-worker.veronica-perezarroyo.workers.dev`
4. Repeat para:
   - **Name**: `NOTIFY_SECRET`
   - **Value**: (el secret que generaste en Paso 4)

---

## Full End-to-End Test (Test Mode)

### Setup

1. Asegúrate que **Stripe está en Test Mode** (toggle arriba en Dashboard)
2. Usa **test payment methods**:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits

### Flow

1. **Start payment**: Click your Stripe payment link
2. **Fill payment form**:
   - Email: `test@example.com`
   - Card: `4242 4242 4242 4242` (test card)
3. **Submit payment** → should succeed
4. **Check email**: Look for post-payment email from Resend (may go to spam)
   - Should have: "Complete your HMU Link service menu"
   - Should have: Tally form link with `order_id=` prefilled
5. **Click Tally link**: Opens form with order_id + customer_email prefilled
6. **Fill service menu data**:
   - Business name
   - Services
   - Hours
   - All required fields
7. **Submit form**: Tally sends webhook to Worker
8. **Check Stripe Dashboard** → Events → should see webhook receive
9. **Check GitHub Actions**: repo → Actions → `Generate HMU Service Menu Page` should be running
10. **Check KV**: 
    ```bash
    cd worker/
    npx wrangler kv key list --remote
    ```
    Should see keys like:
    - `hmu_order:pi_xxx...`
    - `hmu_submission:...`
11. **Check generated page**: `https://www.hmulink.com/links/<slug>/` should exist
12. **Check delivery email**: Should arrive with:
    - Link to public page
    - QR code
    - One-time correction link

### Troubleshooting

| Problem | Solution |
|---|---|
| Webhook not received | Check Stripe endpoint URL in Dashboard; check KV namespace ID in wrangler.toml |
| GitHub Actions not triggered | Check GITHUB_TOKEN has `repo` + `workflow` scope; check Worker code dispatches correctly |
| Email not sent | Check RESEND_API_KEY is valid; check FROM_EMAIL is verified sender in Resend |
| KV write fails | Check KV namespace binding in wrangler.toml matches actual namespace ID |
| Page not generated | Check Python dependencies in requirements.txt; check generator script runs locally |

---

## Going Live

Once test mode works end-to-end:

1. **Switch Stripe to Live**: Toggle in Dashboard
2. **Update payment link**: Use live product payment link
3. **Update landing page CTA**: Point to live Stripe payment link
4. **Verify all secrets**: STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, etc. are for live accounts
5. **Test with small transaction**: Make a real test payment to ensure flow works live
6. **Monitor logs**: Check Cloudflare Worker logs for errors

---

## Configuration Checklist

- [ ] Stripe product created
- [ ] Stripe payment link created + copied
- [ ] Stripe webhook signing secret copied
- [ ] KV namespace created + ID copied
- [ ] `worker/wrangler.toml` updated with KV namespace ID
- [ ] All 5 Worker secrets configured (`wrangler secret put`)
- [ ] Tally webhooks configured + signing secret obtained
- [ ] Tally forms have order_id + customer_email fields
- [ ] Worker deployed (`wrangler deploy`)
- [ ] Worker health check passes
- [ ] GitHub Actions secrets configured (SERVICE_MENU_WORKER_URL, NOTIFY_SECRET)
- [ ] End-to-end test passed in Stripe test mode
- [ ] Ready for live!

---

## Next Steps

1. After deployment + testing:
   - Update `README.md` to remove manual pilot language
   - Update `ARCHITECTURE.md` to mark Phase 6 as implemented
   - Create `docs/ADMIN_RUNBOOK.md` for ongoing operations

2. Monitor first few real sales:
   - Check KV growth (don't exceed quota)
   - Monitor Worker response times
   - Track email delivery rates via Resend dashboard

3. Future improvements:
   - Add dashboard for viewing orders/submissions
   - Add admin endpoint to manually trigger generation
   - Add webhook replay/replay safety
   - Add customer corrections UI (instead of Tally form)
