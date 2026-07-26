# Auditoría del formulario VIVO de HMU Link — 2026-07-26

*Fase 3.5 del `PLAN_CERO_REGRESIONES_2026-07-26.md`.*
**Nada del formulario vivo se tocó.** HMU tiene 4 clientes reales; quitar o
cambiar una pregunta es decisión de Vero. Esto es el reporte.

## Cómo se midió

Contra los **formularios vivos**, por la API de Tally: EN `yPkN5X` y ES
`MeyDpk`, **55 preguntas cada uno**. No contra `tally_form.yaml` del repo — ese
archivo es un borrador que nunca creó estos formularios (lo dice su encabezado),
y compararlo contra el código es lo que le dio 21 falsos positivos al Centro.

Cada pregunta se mide **sola**: se arma un webhook de Tally con esa única
respuesta y se busca el centinela en el payload público que se despacha al
generador. Medirlas todas de golpe hace que dos preguntas condicionales
hermanas se pisen y una parezca perdida sin estarlo.

El candado permanente es `worker/test/form-field-coverage.test.mjs`, y corre en
`node worker/test/run_all.mjs`.

## Resultado: ningún campo se está cayendo en silencio

Las 55 preguntas de cada formulario llegan a su campo del payload, **salvo las 7
de abajo**, todas con razón. Los dos formularios alimentan exactamente los
mismos campos: un cliente no recibe menos página por llenarlo en su idioma.

Además, todas las listas cerradas mapean bien —verificado opción por opción, en
los dos idiomas—: los **12 estilos** (24 opciones) caen en los 12 del catálogo
sin fallback, los **8 botones principales** (16 opciones) resuelven, y los **2
idiomas** también. Ahí es donde vivía el bug de PawContact (`sunny-paws`
cortado en `sunny`), y HMU está limpio.

## Las 7 preguntas que no llegan a ninguna página

| # | Pregunta (EN / ES) | Veredicto |
|---|---|---|
| 1 | Contact email for your HMU Link preview / *Correo de contacto para la vista previa* | **Dato interno.** Vive en el registro de KV para que Vero pueda escribirle al cliente. No se publica a propósito. |
| 2 | Your name / *Tu nombre* | **Dato interno.** Igual que arriba. |
| 3 | Phone or WhatsApp if we have questions / *Teléfono o WhatsApp por si tenemos preguntas* | **Dato interno.** Es el teléfono PRIVADO; el público se pregunta aparte y sí se publica. |
| 4 | How many public locations…? / *¿Cuántas ubicaciones públicas…?* | **Control de lógica del formulario.** Su respuesta decide qué preguntas ve el cliente: gatea «¿Dónde ofreces tus servicios?» y los bloques de Ubicación 1/2/3. Correcto que no viaje. |
| 5 | Please confirm all of the following / *Por favor confirma todo lo siguiente* | **Consentimiento legal.** Tres casillas: derechos sobre logo/fotos/texto, autorización para traducir, y entendido de que la página es pública. Queda en KV como prueba de aceptación. |
| 6 | Términos y Condiciones + Aviso de Privacidad | **Consentimiento legal.** Queda en KV. *(Su título en la API es el id del formulario —`yPkN5X`/`MeyDpk`— porque es la única pregunta que declara un `name`, y cuando hay `name` Tally reporta el nombre en vez del título. Es el mismo mecanismo que rompió PawContact, aquí visible en pequeño y sin daño.)* |
| 7 | **Brand notes / *Notas de marca*** | **PREGUNTA MUERTA — para decisión de Vero.** El cliente escribe sus preferencias de marca («nuestro color es verde olivo», «eviten el rosa») y **no la lee nadie**: cero referencias en todo el repo, ni en el worker ni en el generador. Es la gemela de `price_display` en PawContact: le quita tiempo al cliente y ensucia el intake. |

**De las 7, seis son correctas.** La única candidata a quitar es la 7.

## Tres cosas más que salieron al medir

### A. Dos pares de preguntas se pisan entre sí (arreglo en el MOTOR — fichado)

Dos preguntas distintas alimentan el mismo campo. `answerAny` se queda con la
primera no vacía, así que si el cliente contesta las dos, **la segunda se pierde
en silencio**. Y sí pueden aparecer juntas:

- **`service_area_text`** ← «¿Dónde ofreces tus servicios?» (se muestra si eligió
  *sin ubicación física*) y «¿Qué zonas cubres?» (se muestra si el giro es
  *servicios a domicilio*). Un negocio a domicilio sin local es el caso normal,
  no el raro.
- **`client_care_text`** ← «¿Cómo atiendes a tus clientes?» y «¿Trabajas con
  clientes en línea, en persona o ambas?». Las dos se le muestran al giro
  *Terapeuta / Profesional del bienestar*.

No se arregla aquí: `answerAny` es código del motor, y HMU es un export. La otra
salida —hacer las preguntas mutuamente excluyentes— es tocar el formulario vivo.
**Queda fichado para la sesión del motor.** El daño es acotado: las dos preguntas
de cada par son del mismo tema, así que la página sale con una respuesta buena,
no vacía.

### B. El bloque de Portafolio nunca se pinta en HMU

El motor sabe pintar un botón de **Portafolio** (`blocks.portfolio`, habilitado
para *creative, beauty, wellness, professional, fitness* — casi todos los giros de
HMU), y el generador lo construye si llega `portfolio_link`. **Ninguno de los dos
formularios vivos lo pregunta**, así que ese bloque no se pinta jamás para un
cliente de HMU. Es el espejo de una pregunta muerta: un **bloque muerto**.
Decisión de Vero: agregar la pregunta al formulario, o dejarlo así.

### C. `price_display` SÍ funciona en HMU — no la quites

La Fase 2 del plan la anota como «llega y se ignora». **En HMU no**: el worker la
pasa, `normalize_price_policy` la traduce y `generate_service_menu.py` esconde
los precios de verdad. Verificado opción por opción en los dos idiomas —
*mostrar / mixto / no mostrar* → `show / mixed / hide`. El hallazgo del plan es
de PawContact, no de aquí.

## Lo que este candado atrapa a partir de ahora

Se probó rompiéndolo a propósito: se cambió un alias de
`tally-field-aliases.json` para simular el bug del 07-26 y la prueba señaló la
pregunta exacta —«List your services with prices»— por su título, en vez de
pasar en verde como pasó el 26 de julio.
