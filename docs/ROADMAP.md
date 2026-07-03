# Roadmap — Service Menu App

## Phase 0 — Documentación y arquitectura

Estado actual. Definir y aprobar:

- Estructura del repo.
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md): alcance del MVP.
- [DATA_CONTRACT.md](DATA_CONTRACT.md): modelo de datos.
- [ARCHITECTURE.md](ARCHITECTURE.md): diseño técnico.
- [SECURITY.md](SECURITY.md): reglas de seguridad y separación de MyGuest.

Sin código funcional. Salida de esta fase: arquitectura y contrato de datos aprobados por
el usuario.

## Phase 1 — Generador HTML + demos dummy

- Implementar el generador que transforma `service_menu_payload_public` en HTML estático.
- Soportar los 6 estilos cerrados de `brand_style` (`black-gold`, `soft-blush`,
  `charcoal-clean`, `warm-sand`, `aqua-clean`, `sage-calm`) mediante un template base
  común + una paleta CSS por estilo. Sin colores libres.
- Crear una página demo por estilo (6) con datos ficticios para validar diseño y contenido.
- Validar contra [QA_CHECKLIST.md](QA_CHECKLIST.md) (secciones de generación, campos,
  mobile, caracteres especiales, links).
- Sin integración con Stripe/Tally/Worker todavía; payloads de entrada son archivos
  locales.

## Phase 2 — GitHub Actions

- Workflow que toma un `service_menu_payload_public` y ejecuta el generador de Phase 1
  automáticamente.
- Publicación automática a GitHub Pages.
- Convenciones de naming para el repo/workflows ya definidas en
  [ARCHITECTURE.md](ARCHITECTURE.md#naming-sugerido).

## Phase 3 — Worker + KV

- Cloudflare Worker propio (`service-menu-worker`) con KV namespace propio
  (`SERVICE_MENU_KV`).
- Endpoints para recibir webhooks (aún sin conectar a Stripe/Tally reales; probar con
  requests simulados).
- Lógica de idempotencia por `order_id` y `correction_token`.
- Disparo de GitHub Actions vía `repository_dispatch`.

## Phase 4 — Stripe/Tally

- Conectar Stripe Payment Link real y su webhook.
- Conectar formulario Tally real y su webhook.
- Validación de firmas de ambos webhooks (ver [SECURITY.md](SECURITY.md)).
- Checklist de secrets futuros completado antes de esta fase.

## Phase 5 — Emails y correcciones

- Integración con proveedor de email (Resend u otro) para email post-pago y email de
  entrega.
- Implementación completa del flujo de corrección one-time.

## Phase 6 — QA end-to-end

- Recorrer [QA_CHECKLIST.md](QA_CHECKLIST.md) completo con el pipeline real conectado.
- Prueba end-to-end: pago dummy → intake dummy → generación → publicación → entrega →
  corrección.
- Verificación de idempotencia con eventos duplicados reales de Stripe/Tally.

## Phase 7 — Landing, pricing y primeras ventas

- Página de venta del producto (landing propia, separada de MyGuest).
- Confirmar paquetes/precios definidos en [PRODUCT_SPEC.md](PRODUCT_SPEC.md) contra
  mercado real.
- Primeras ventas reales, documentadas siguiendo
  [RUNBOOK.md](RUNBOOK.md#cómo-documentar-la-primera-venta).
