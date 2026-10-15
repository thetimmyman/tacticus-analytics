# Guild roster requests

Membership comes from the documented key-owner `/api/v1/guild` response. Node roster refreshes use that endpoint rather than probing `/guild/<id>/members`. A non-empty, complete member list must identify the expected guild before it can confirm membership or transfers; missing identity, mismatches and malformed members fail closed.

Initial synchronization shares its successful validation response with guild discovery, war-season detection and membership reconciliation. Edge synchronization reuses the guild response it already fetched alongside raid data. The response stays in the current authorized operation and is not placed in a process-wide cache or the validation result. No authorization boundary or freshness interval changes.

When a background Node roster refresh has no supplied response, it makes its existing bounded read against `/guild`. Existing retries and timeouts remain bounded; HTTP 429 returns without another attempt, and unread error bodies are cancelled. Malformed response content is not included in errors or logs.

The legacy edge member-probe helper remains disabled unless an explicitly supported API variant opts in; the standard synchronization workflow does not call it. Endpoint recognition or an internal opt-in is not evidence of provider permission.

Synthetic verification covers the requested path and physical read count, same-operation reuse, identity/roster rejection, preserved membership transfer guards, error-body release, timeouts, response privacy and initial-sync wiring.
