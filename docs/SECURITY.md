# Security — Service Menu App

## Repo público

- El repo `yuyitov/service-menu-app` es **público** (requisito de GitHub Pages en plan
  Free). Nada sensible puede commitearse: ni secrets, ni tokens, ni emails/teléfonos/
  direcciones reales de clientes. Todo dato visible en demos y landing es ficticio.

## Página pública sin datos sensibles

- La página final (`service_menu_payload_public`) solo contiene datos que el negocio
  quiere mostrar públicamente: nombre, descripción, servicios, precios, horarios,
  dirección, contacto (WhatsApp/Instagram), Maps, Reviews y políticas.
- No debe contener: `order_id`, `payment_intent_id`, `customer_email`, `correction_token`,
  ni ningún campo interno del `service_menu_order` o `service_menu_intake` que no esté
  explícitamente listado en `service_menu_payload_public` (ver [DATA_CONTRACT.md](DATA_CONTRACT.md)).

## No pedir datos sensibles al cliente final

- La página pública nunca solicita tarjetas de crédito, login, contraseñas ni datos
  médicos del cliente final que la visita.
- El intake (Tally) del dueño del negocio tampoco debe solicitar datos médicos ni de
  tarjeta; los pagos ya ocurrieron vía Stripe Payment Link antes del intake.

## Separación de secrets respecto a MyGuest

- No se copian secrets de MyGuest (API keys, tokens, webhook secrets) bajo ninguna
  circunstancia, ni siquiera como referencia o plantilla con valores reales.
- Todos los secrets de Service Menu App se generan/rotan de cero, específicos para este
  proyecto.
- No se reutiliza ninguna cuenta de servicio, token de GitHub, ni credencial de Stripe/
  Resend que ya esté en uso por MyGuest.

## No mezclar KV/Worker con MyGuest

- El Worker de Service Menu App se despliega como un Worker independiente, con su propio
  nombre (`service-menu-worker`) y sus propias rutas.
- El namespace de KV (`SERVICE_MENU_KV`) es exclusivo de este proyecto; no se lee ni
  escribe en el KV de MyGuest bajo ninguna circunstancia.
- No se agregan bindings cruzados entre el `wrangler.toml` de MyGuest y el de Service
  Menu App.

## Validación de webhooks

- Todo webhook entrante (Stripe, Tally) debe validarse por firma antes de procesar:
  - Stripe: verificar `Stripe-Signature` contra el webhook secret propio del proyecto.
  - Tally: verificar el secret/firma de Tally propio del proyecto, si Tally lo provee;
    de lo contrario, restringir por origen conocido y validar estructura del payload.
- Cualquier webhook que falle la validación de firma se rechaza (HTTP 4xx) y se registra,
  sin procesar su contenido.

## Protección contra submission sin `order_id`

- Ningún submission de Tally se procesa si no trae un `order_id` válido y existente en
  `service_menu_order` con status compatible (`intake_sent` o `paid`).
- Un submission con `order_id` inexistente o ya en un estado posterior (`published`,
  `delivered`, etc., fuera del flujo de corrección) se rechaza y se registra como intento
  sospechoso, no se crea un intake nuevo silenciosamente.

## Uso de tokens

- `correction_token` se usa exclusivamente para el flujo de corrección incluida y para
  previsualización antes de publicar, si aplica.
- Los tokens son de un solo uso: al consumirse (`used_at` seteado), cualquier reuso se
  rechaza.
- Los tokens deben ser generados con suficiente entropía (no secuenciales, no
  predecibles a partir del `order_id`).
- Los tokens no se exponen en la página pública ni en logs persistentes en texto plano
  más allá de lo estrictamente necesario para depuración de corto plazo.

## Reglas de no exposición en GitHub Pages

- El repositorio que alimenta GitHub Pages contiene únicamente el HTML/assets generados
  a partir de `service_menu_payload_public`; nunca el intake completo ni el order.
- No se commitea ningún secret, `.env`, ni credencial en el repo de páginas ni en el repo
  principal.
- El historial de commits de páginas generadas no debe incluir datos que luego se
  corrigieron y se querían retirar (evaluar squash/regeneración limpia en vez de mantener
  historial con datos obsoletos si el cliente pide remover información sensible).

## Manejo de imágenes y uploads

- Las imágenes (`primary_image_url`, `logo_url`) provienen de un upload controlado
  (ej. vía el propio Tally o un endpoint del Worker), nunca de URLs arbitrarias sin
  validar en el MVP inicial.
- Validar tipo de archivo (solo formatos de imagen esperados) y tamaño máximo antes de
  aceptar un upload.
- No se ejecuta procesamiento de imágenes que interprete contenido como código (sin
  SVG con scripts embebidos, por ejemplo, salvo que se sanitice explícitamente).

## Checklist de secrets futuros

Antes de Phase 4 (Stripe/Tally reales) y Phase 3 (Worker/KV reales), confirmar que
existen y están correctamente scoped:

- [ ] `SERVICE_MENU_STRIPE_SECRET_KEY` — clave de Stripe propia del proyecto.
- [ ] `SERVICE_MENU_STRIPE_WEBHOOK_SECRET` — secret del webhook de Stripe.
- [ ] `SERVICE_MENU_TALLY_WEBHOOK_SECRET` — secret/validación del webhook de Tally.
- [ ] `SERVICE_MENU_GITHUB_TOKEN` — token con permisos mínimos necesarios (repository
      dispatch + push al repo de páginas), no un token personal de uso general.
- [ ] `SERVICE_MENU_RESEND_API_KEY` (o equivalente) — clave del proveedor de email.
- [ ] Ninguno de los anteriores coincide en valor ni en nombre de variable con los
      secrets usados por MyGuest.
