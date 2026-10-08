# HMU release readiness and controlled cutover

This branch is prepared for review and offline tests. It is not a deployment and
is not approval to begin sales. Source baseline: main commit
`121e4989314d4c9b637d5d63fede668c756d02ba` (28 September 2026).

## Changes prepared

- Initial, gift and modification delivery is confirmed only after provider
  acceptance. Explicit provider 4xx rejection is retryable with a stable order
  and token. Network timeouts, HTTP 408 and 5xx outcomes are held for review.
- A named Durable Object serializes requests across provider awaits. Its storage
  owns new writes and atomic multi-record reservations; KV is only a read-only
  fallback for legacy data. KV is never used as an atomic mutex.
- One active generation per page prevents simultaneous free/paid token edits.
  Entitlement is checked before dispatch and committed once after publication.
  Verified generation failure restores the reservation. Uncertain deployment or
  notification failure does not grant an extra edit.
- The workflow waits for its exact generated revision to deploy through the
  reusable Pages workflow before notifying. HTTP failures fail the notify job.
  Both concurrency groups use `queue: max` (100 pending runs maximum).
- Stable form fields are retained across blank/no-change submissions. The two
  `q_` aliases for service area and online/in-person service are covered.
- Prebuilt gifts require a usable prefill. Missing data and oversized URLs fail
  explicitly instead of silently delivering free text or dropping answers.
- Input bodies are bounded before entering the state queue. Provider fetches
  have deadlines. Expiry cleanup removes payloads and old limiter entries;
  tombstones prevent a deleted record from reappearing through legacy KV.

## Remaining release blockers

1. The existing 6000-character prefill budget is a project limit, not a documented
   Tally limit. Tally documents URL-driven default answers but publishes no
   guaranteed maximum in the references below. Cloudflare's 16 KB Worker URL
   limit does not establish a limit for a URL sent directly to Tally. Do not
   raise this budget or call complete-profile editing solved without browser,
   email-link and real-form boundary tests. Oversized valid profiles currently
   require resolution; they are not silently truncated.
2. These tests use an in-process Durable Object/storage model, not Cloudflare's
   actual SQLite/Workers runtime. Wrangler and Miniflare were unavailable in the
   preparation environment. Run a real isolated runtime integration before
   approval. New DO binding/migration configuration is prepared, not activated.
3. Confirm the active Worker revision, GitHub dispatch permission and SendGrid
   account health without exposing credential values. Do not rotate or create
   credentials under this branch's preparation authorization.
4. Complete both controlled end-to-end paths: paid intake and prebuilt gift,
   received email, real prefilled form, first text/photo change, unchanged URL
   and retained data, confirmation mail, second updated form and 2→1→0 quota.
   Verify repeats, failures and a rejected third free request. No real payment,
   recipient email, test publication or deployment was performed here.
5. Legacy free-text edits change the published client JSON without reconstructing
   a complete Tally answer snapshot. They remain a legacy recovery path and must
   not be used to certify the new prefilled questionnaire experience.
6. Upstream shared-engine export may overwrite standalone worker changes. Review
   and coordinate the corresponding source-of-truth update before a later export;
   no sibling repository has been changed by this branch.

## Controlled state cutover

A production transition requires separate approval. Do not use a gradual rollout
or roll back directly to the KV-only worker after this version starts writing.

- Establish an approved write-pause window. Drain old generation and notification
  jobs, including retries, and verify all acknowledged changes are delivered.
- Old in-flight modifications used `status: received` and eagerly burned tokens;
  they do not carry the new reservation/attempt records. Finish them under the
  old version or explicitly reconcile/migrate them before the transition. Old
  already-notified callbacks remain idempotent.
- Verify legacy KV records after propagation during the write pause. Keep an
  approved recoverable backup and an explicit rollback/data-export plan. The
  read-only fallback is not a live bidirectional migration mechanism.
- Validate the SQLite class migration and HMU_STATE binding in an isolated
  environment first. The HMU configuration fails closed when the required
  binding/mode is absent. Do not invoke the new admin operations in production
  without authorization for the exact target and outcome.
- Run the end-to-end acceptance matrix and review queue/backlog state before
  opening normal traffic. A canceled or queue-full job may never execute its
  alert step, so monitor Actions outcomes and reconcile affected reservations.

## Recovery of uncertain external outcomes

Do not infer rejection from elapsed time. Inspect the exact SendGrid activity or
GitHub run/deployment first. `/reconcile-operation` uses the existing
`Authorization: Bearer <NOTIFY_SECRET>` and never sends email or dispatches a job.
Keep that credential in the authorized secure environment, never in chat, URLs,
repository files or logs.

Read-only inspection uses POST JSON with `action: inspect`:
- Email: `kind: email`, `outbox_key`, for example `delivery:<slug>`.
  It returns the current `attempt_id`, status, start time and provider ID.
- Generation: `kind: generation`, `record_kind: submission` or
  `correction_request`, and its exact `id`. It returns status and attempt number.

An authorized decision also requires `outcome: accepted` or `rejected`, a
human-readable `reason` and `provider_reference` identifying the verified source.

For email, include the exact inspected `attempt_id`. An accepted decision marks
that attempt sent; replaying its original notification finalizes local state
without another email. A rejected decision permits the same operation to try
again. A delayed decision from an older attempt cannot release a newer attempt.
Do not choose either outcome if the provider evidence remains inconclusive.

For generation, include the exact `generation_attempt`. An accepted dispatch
continues waiting for the matching publication callback. Confirmed rejection or
cancellation before publication releases its matching page/token reservation;
then replay the original event to create a new numbered attempt. Both the release
and its audit evidence commit atomically. Completed quota cannot be replenished.
A generation with confirmed publication cannot be released as rejected.

If Pages succeeded and notification failed, retry `/notify` for that exact
attempt after resolving its email/storage issue. Do not regenerate the page.
For an uncertain deployment, inspect the deployment result before taking action.
A missing or inconclusive outcome stays held for manual reconciliation.

## Offline checks

`node worker/test/run_all.mjs` runs the repository suite without external access.
`python worker/test/test_workflow_contract.py` checks workflow dependencies and
the new processing-state wiring; these are structural checks, not hosted CI.
The release-readiness test file mocks all provider calls and exercises actual
worker entry points with signed synthetic events and persistent in-memory state.
It covers paid/gift parity, two changes, races, replay, authentication, provider
rejections and ambiguity, restarts, atomic write failure, expiry, body limits,
manual reconciliation and stale-attempt protection.

The Python generator was also checked with synthetic data and mocked image
retrieval/translation: changing text preserves old photos, hours and policies;
a supplied gallery replaces the old set; both language HTML views render.
QR generation, visual browser QA, real uploads/translations and production
workflow execution remain unrun.

## Primary references

- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/workers/platform/limits/
- https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://tally.so/help/pre-populate-form-fields
- https://developers.tally.so/widgets/embeds
- https://developers.tally.so/widgets/events
