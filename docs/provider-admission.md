# Provider dispatch admission

Status: local integration under qualification. This does not certify complete
provider coverage, enable production enforcement or establish provider permission.

The portable client in `supabase/functions/_shared/provider-admission.ts` speaks the
existing authenticated dispatch-authority contract. It adds no queue, payload proxy
or provider retry. Existing application queues own deferral. Node's existing
`providerFetch` boundary uses this client and retains its existing async scope for
operation attribution, retry state and physical job counters.

Server-only configuration:

| Variable                     | Meaning                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_ADMISSION_MODE`    | Absent or `off` preserves existing local controls. `enforce` requires complete configuration and operation attribution. Other values refuse provider traffic. |
| `PROVIDER_ADMISSION_ORIGIN`  | Exact HTTP(S) authority origin, without path, credentials or query.                                                                                           |
| `PROVIDER_ADMISSION_TOKEN`   | Admission-only caller credential; the authority binds its application scope.                                                                                  |
| `PROVIDER_ACCOUNT_LABEL_KEY` | Common private HMAC key, at least 32 UTF-8 bytes, shared only by enrolled runtimes.                                                                           |

Never expose these values to a browser or a public build variable. The account
label key is separate from application encryption keys. Labels derive from the
actual effective API header or game account in the request path, preserve case,
and hide raw credential, account and session values. Configuration and controller
errors have a static local error message; response bodies are not logged.

Each provider send needs an application-owned purpose, trigger and timeout.
`withProviderOperation` uses the existing Node async scope and isolates concurrent
operations. Scheduled work must retain its scheduled trigger; request parameters
must not select priority. Unattributed work is refused when enforcement is on.
Recognized endpoint templates are a closed vocabulary, not proof of authorization.
The optional member endpoint, root probes and arbitrary requests are refused.
The existing anonymous `/globalConfig` fallback currently has no registered
controller template and remains an enrollment blocker pending an explicit interface
decision. HTTP admission does not admit WebSocket connections.

The authority reserves and acknowledges a single attempt UUID immediately before
one physical send. Redirects are refused. Control requests have bounded full-body
reads, no retries and no direct-provider fallback. Denials preserve the complete
positive `Retry-After` hold; callers must not convert huge holds into JavaScript
sleep timers. Local admission refusals bypass provider retry ladders and provider
circuit strikes. They must not be recorded as rejected API credentials.

The client polls the authority while awaiting headers and consuming a body. EOF or
fulfilled reader cancellation proves completion. Cancellation is requested before
aborting the transport so a native abort does not erase that proof. An unsettled
cancellation reports uncertainty; the authority retains its capacity until verified
operator recovery. A cancelled fetch awaiting headers has no owned response reader
to prove settlement, so its rejection also retains uncertainty after dispatch. A lost outcome receipt must never cause an automatic resend or
permit release. The existing physical counters increment at the admitted send,
exclude all control exchanges and record zero provider calls for local refusal.

Before enrollment, qualify every runtime's actual physical boundary, scheduling
and typed deferral, account-session ownership, complete telemetry and shutdown
behavior against the released authority. Missing configuration must stay closed.
The default-off state is an integration gate. Turning enforcement off bypasses
central control and is not the emergency shutdown procedure. Use the authority's
disabled policy for shutdown and verify active transport closure plus retained
uncertainty; preserve unrelated application traffic. Coordinate any unenrollment
or rollback with the release owner after stopping provider work.

Synthetic Node and Deno controls cover the closed protocol, privacy, denial,
body ownership, cancellation, retries and physical counts. A loopback HTTP test
checks actual connection closure. They make no requests to live provider servers.
Production policy values, whole-estate monitoring and approved interface/account
dispositions remain separate qualification requirements.
