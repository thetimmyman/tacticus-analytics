Run the real HTTP controls on Linux with Python 3 and Docker:

```sh
npm run app:identity:check
python3 scripts/testing/postgrest-readonly/run.py
```

The runner uses PostgreSQL 17.4 and PostgREST 12.2.8 images pinned by digest.
It creates only synthetic roles, data and signing material in disposable
containers on an internal Docker network. It publishes no ports, mounts no
host files and needs no application credentials. It removes its containers
and network on exit. No production helper or endpoint is used.

The actual committed reader and readonly-hook migrations are applied to a
minimal fixture. The old hook first demonstrates service credential
reads through a streaming standby. The successor must refuse that effective
role with HTTP 403 / SQLSTATE 42501 for relation GET/HEAD, a view and invoker
and definer stable RPCs, while the same primary requests remain successful.
Conflicting `role` and `db_role` claims exercise the configured `.role`
mapping. The reader's actual identity RPC and ordinary readers remain
available. Reader credential projections remain refused by the source
reader grants. The actual source ban function rejects a synthetic banned
authenticated identity; the fixture supplies its minimal auth relations.

Wrong-database apply, drifted predecessor and drifted rollback controls must
fail without changing the expected ledger state. Actual rollback restores
the old HTTP behavior; reapply restores denial. The standby must replay each
change before the next assertion. Promotion must reuse a warmed backend and
preserve caller denial, reader reads and mutation rejection, including nested
definer transaction escape and sequence changes. Primary writes remain
successful. Catalog comparisons additionally detect table/column grant or
role-membership changes.

`--baseline-only` runs the old-hook positive controls. The deliberately red
`--expect-denied-old-hook` control must fail on the successful service
credential GET; it demonstrates that the HTTP assertions detect the original
exposure. Normal CI uses the full runner and requires all checks to pass.

This is a focused boundary fixture, not a complete production schema replay
or an audit of every allowed role and RPC. Source pgTAP suites independently cover broader catalog invariants.
