# Pilot Payment and Delivery — cobro y entrega del piloto

Cómo cobrar y entregar al primer cliente (piloto) **sin** Stripe, sin checkout
en el sitio y sin automatización. Complementa
[FIRST_CLIENT_RUNBOOK.md](FIRST_CLIENT_RUNBOOK.md).

## Principios

- El pago es **manual y por adelantado** (o el piloto es explícitamente
  gratis/descuento, acordado por escrito).
- El formulario de intake **no cobra nada** y así debe seguir en esta fase.
- Nunca pedir ni anotar datos de tarjeta manualmente (ni por WhatsApp, ni por
  teléfono, ni en notas). Si el cliente quiere pagar con tarjeta, se le envía
  un link de pago de un proveedor (fase posterior) — jamás se procesa a mano.
- Ningún dato de pago entra al repo: ni montos acordados, ni comprobantes, ni
  referencias. Registro privado fuera del repo.

## Opciones de cobro para el piloto (en orden de preferencia)

1. **Transferencia bancaria (SPEI en MX / Zelle-ACH en US)** — sin comisión,
   sin integraciones. Confirmar recepción antes de generar.
2. **Efectivo** — solo si es local y práctico; dar recibo simple.
3. **Payment link de un proveedor (Stripe Payment Link u otro)** — solo si se
   decide explícitamente más adelante; NO se implementa en esta fase.

## Precio del piloto

- El precio de la landing es tentativo ("launch pricing · subject to change").
- Para el piloto se recomienda precio fundador con descuento a cambio de:
  testimonio + permiso de usar su página como ejemplo público.
- Confirmar SIEMPRE por escrito: qué incluye (página bilingüe + QR + 1
  corrección), precio, y que es pago único sin renovación.

## Secuencia de entrega (resumen; detalle en el runbook)

1. Lead por Tally → revisión → acuerdo de precio por escrito.
2. Pago recibido y confirmado.
3. JSON público → generación bilingüe → QA local
   ([FIRST_CLIENT_QA_CHECKLIST.md](FIRST_CLIENT_QA_CHECKLIST.md)).
4. Publicar → enviar **vista previa** (link + QR) al correo interno.
5. 1 ronda de correcciones incluida → aplicar → republicar.
6. Entrega final: link + QR + recordatorio de que cambios futuros se cotizan
   aparte ($3 USD por revisión extra según pricing tentativo, o lo acordado).

## Qué NO prometer al piloto

- Que HMU Link responde WhatsApp, gestiona reservas o cobra a sus clientes.
- Renovaciones, mantenimiento continuo o cambios ilimitados.
- Posicionamiento en Google ni resultados de marketing.
- Fechas de entrega imposibles: comprometer 3–5 días hábiles es razonable.
