# Contribution contract v1

`packages/contribution/contract.mjs` validates exact allowlists. Native adapters
own local policy storage and authenticated transport; keys are never fields in
this contract. All purposes and datasets start disabled. Changing a policy must
increase its revision. Connections, diagnostics and update checks do not grant
contribution consent. `accountRef` is a local account reference, not a claim that
the Player API proves account ownership.

Envelopes carry a request UUID, service binding UUID, consent revision, purpose,
dataset, upstream guild UUID, season, observation time and bounded rows. Raid
rows contain only `RAID_FIELDS`. War/replay rows contain a format version and a
minimal outcome; neither dataset has an independent official source in the
currently documented API and both remain unverifiable. No raw replay is sent.

Receipts identify the request, revision, server check time and per-row result.
An authority digest identifies independently fetched data; a client digest or
signature never establishes truth. A receipt is meaningful only when returned
through an authenticated verification service. Consumers must match the request
and revision, reject replay, and check current consent before applying it.

The official [API schema](https://api.tacticusgame.com/api-docs) describes Player,
Guild and Guild Raid endpoints. Player metadata reports scopes and expiry;
Player details expose a name and power level, not a stable player identity.
Guild members expose user identifiers. Guild Raid exposes season and raid rows;
it does not expose war or replay truth. Only independently matched fields may
enter verified aggregates. Publisher terms and protected service custody review
remain prerequisites for production enrollment.
