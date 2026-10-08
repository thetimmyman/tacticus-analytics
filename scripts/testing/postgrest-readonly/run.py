#!/usr/bin/env python3
"""Real HTTP caller-boundary and promotion controls; synthetic isolated Docker data."""

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
DATABASE = "postgres"
AUTHENTICATOR = "authenticator"
ANON = "anon"
AUTHENTICATED = "authenticated"
SERVICE_ROLES = ("service_role",)
READER = "rest_reader"
BROKER = None
CLAIM_KEY = "role"
READER_MIGRATION = "20261007210000_rest_reader_role.sql"
PREDECESSOR = "20261008150000_readonly_request_transaction.sql"
SUCCESSOR = "20261008200000_readonly_caller_boundary.sql"
ROLLBACK = "supabase/snippets/20261008200000_rollback_readonly_caller_boundary.sql"
VERSION = "20261008200000"
BAN_SOURCE = "20260824130000_close_ban_and_pr56_review_boundaries.sql"
PG_IMAGE = "postgres:17.4-alpine@sha256:7062a2109c4b51f3c792c7ea01e83ed12ef9a980886e3b3d380a7d2e5f6ce3f5"
REST_IMAGE = "postgrest/postgrest@sha256:e5978740a590628f2114730bb942f35342ea70b8b7a86697a3df283c0caea109"
DENIAL = "Role is not permitted on the read-only endpoint"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Fixture:
    def __init__(self):
        self.name = f"readonly-http-{os.getpid()}-{time.time_ns()}"
        self.primary = self.name + "-primary"
        self.standby = self.name + "-standby"
        self.containers = []
        self.secret = os.urandom(32).hex()
        self.network_created = False
        self.checks = 0

    def docker(self, *args, input=None, fail=False):
        result = subprocess.run(
            ["docker", *args], input=input, text=True, capture_output=True, timeout=90
        )
        if fail:
            require(result.returncode != 0, "negative SQL control unexpectedly passed")
        elif result.returncode:
            raise RuntimeError(f"docker {args[0]}: {result.stderr[-3000:]}")
        return result.stdout.strip()

    def sql(self, sql, database=DATABASE, standby=False, fail=False):
        return self.docker(
            "exec", "-i", self.standby if standby else self.primary,
            "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database,
            "-v", "ON_ERROR_STOP=1", input=sql, fail=fail,
        )

    def wait(self, check, label):
        for _ in range(150):
            try:
                if check():
                    return
            except (RuntimeError, OSError, ValueError):
                pass
            time.sleep(0.1)
        raise RuntimeError(f"timed out waiting for {label}")

    def launch(self, name, image, *args, env=()):
        command = ["run", "--rm", "-d", "--name", name, "--network", self.name]
        for item in env:
            command.extend(("-e", item))
        command.extend(args)
        command.append(image)
        self.docker(*command)
        self.containers.append(name)

    def token(self, role, claims=None):
        def encode(value):
            return base64.urlsafe_b64encode(value).decode().rstrip("=")
        body = {"role": role, CLAIM_KEY: role, "exp": int(time.time()) + 600}
        body.update(claims or {})
        unsigned = encode(b'{"alg":"HS256","typ":"JWT"}') + "." + encode(
            json.dumps(body).encode()
        )
        return unsigned + "." + encode(
            hmac.new(self.secret.encode(), unsigned.encode(), hashlib.sha256).digest()
        )

    def http(self, endpoint, method, path, role, data=None, claims=None):
        request = urllib.request.Request(
            f"http://{endpoint}:3000/{path}", method=method,
            headers={"Authorization": "Bearer " + self.token(role, claims),
                     "Content-Type": "application/json", "Prefer": "tx=commit"},
            data=None if data is None else json.dumps(data).encode(),
        )
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        return response.status, json.loads(raw) if raw else None

    def expect(self, endpoint, method, path, role, status, body=None, **kwargs):
        actual_status, actual_body = self.http(endpoint, method, path, role, **kwargs)
        require(actual_status == status,
                f"{method} {path} as {role}: expected {status}, got {actual_status}: {actual_body}")
        if body is not None:
            require(actual_body == body, f"{method} {path}: unexpected body {actual_body}")
        self.checks += 1
        return actual_body

    def error(self, endpoint, method, path, role, code, message=None, **kwargs):
        status, body = self.http(endpoint, method, path, role, **kwargs)
        require(status >= 400 and body and body.get("code") == code,
                f"{method} {path} as {role}: expected {code}, got {status}: {body}")
        if message:
            require(body.get("message") == message, f"unexpected error message: {body}")
        if code == "42501" and message == DENIAL:
            require(status == 403, f"caller denial must map to HTTP 403, got {status}")
        self.checks += 1

    def api(self, label, database_container, hook=True):
        name = self.name + "-" + label
        env = [
            f"PGRST_DB_URI=postgres://{AUTHENTICATOR}@{database_container}:5432/{DATABASE}",
            f"PGRST_JWT_SECRET={self.secret}", "PGRST_DB_SCHEMAS=public",
            f"PGRST_DB_ANON_ROLE={ANON}", f"PGRST_JWT_ROLE_CLAIM_KEY=.{CLAIM_KEY}",
            "PGRST_DB_POOL=1", "PGRST_DB_POOL_MAX_LIFETIME=1800",
            "PGRST_DB_CHANNEL_ENABLED=false", "PGRST_DB_CONFIG=false",
            "PGRST_DB_USE_LEGACY_GUCS=false",
        ]
        if hook:
            env.append("PGRST_DB_PRE_REQUEST=postgrest_readonly.pre_request")
        self.launch(name, REST_IMAGE, env=env)
        ip = self.docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name)
        self.wait(lambda: self.http(ip, "GET", "fixture_public", READER)[0] == 200,
                  "PostgREST " + label)
        return ip

    def grants(self):
        # Catalog receipt supplements HTTP primary-positive controls: no global revoke.
        return self.sql("""
SELECT rolname, rolinherit, rolbypassrls FROM pg_roles
 WHERE rolname <> 'postgres' AND rolname NOT LIKE 'pg_%' ORDER BY rolname;
SELECT roleid::regrole, member::regrole, admin_option, inherit_option, set_option
 FROM pg_auth_members ORDER BY 1,2;
SELECT n.nspname,c.relname,c.relacl::text,a.attname,a.attacl::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname='public' ORDER BY c.relname,a.attnum;
""")

    def credential_reads(self, endpoint, denied=False):
        for role in SERVICE_ROLES:
            for method, path, body, data in (
                ("GET", "guild_config?select=client_secret&guild_code=eq.FIXTURE", [{"client_secret": "synthetic-secret"}], None),
                ("HEAD", "guild_config?select=client_secret", None, None),
                ("GET", "fixture_secret_view", [{"client_secret": "synthetic-secret"}], None),
                ("GET", "rpc/fixture_secret", "synthetic-secret", None),
                ("POST", "rpc/fixture_secret", "synthetic-secret", {}),
                ("GET", "rpc/fixture_definer_secret", "synthetic-secret", None),
                ("POST", "rpc/fixture_definer_secret", "synthetic-secret", {}),
            ):
                if denied and method != "HEAD":
                    self.error(endpoint, method, path, role, "42501", DENIAL, data=data)
                else:
                    self.expect(endpoint, method, path, role, 403 if denied else 200, body, data=data)

    def allowed_reads(self, endpoint, in_recovery):
        expected = [{"id": 1, "value": "original"}]
        self.expect(endpoint, "GET", "fixture_public", READER, 200, expected)
        self.expect(endpoint, "HEAD", "fixture_public", READER, 200)
        for method, data in (("GET", None), ("POST", {})):
            identity = self.expect(endpoint, method, "rpc/rest_reader_whoami", READER, 200, data=data)
            require(identity["role"] == READER and identity["db"] == DATABASE
                    and identity["in_recovery"] == in_recovery
                    and identity["writable_exposed_relations"] == 0,
                    f"reader token did not resolve correctly: {identity}")
        self.error(endpoint, "GET", "guild_config?select=client_secret", READER, "42501")
        for role in (ANON, AUTHENTICATED):
            self.expect(endpoint, "GET", "fixture_public", role, 200, expected)
        if BROKER:
            for code, rows in (
                ("FIXTURE", [{"user_id": "fixture-user", "client_secret": "synthetic-secret"}]),
                ("ABSENT", []),
                ("NULLS", [{"user_id": None, "client_secret": None}]),
            ):
                self.expect(endpoint, "GET", f"guild_config?guild_code=eq.{code}&select=user_id,client_secret&limit=1",
                            BROKER, 200, rows)
            self.error(endpoint, "GET", "guild_config?select=*", BROKER, "42501")
            self.error(endpoint, "GET", "guild_config?select=internal_token", BROKER, "42501")
        if BAN_SOURCE:
            self.error(endpoint, "GET", "fixture_public", AUTHENTICATED, "42501", "Account suspended",
                       claims={"sub": "00000000-0000-4000-8000-000000000001"})

    def claim_mapping(self, endpoint):
        if CLAIM_KEY == "role":
            self.error(endpoint, "GET", "guild_config?select=client_secret", SERVICE_ROLES[0],
                       "42501", DENIAL, claims={"db_role": READER})
            self.expect(endpoint, "GET", "fixture_public", READER, 200,
                        claims={"db_role": SERVICE_ROLES[0]})
        else:
            for role in SERVICE_ROLES:
                self.error(endpoint, "GET", "guild_config?select=client_secret", role,
                           "42501", DENIAL, claims={"role": "authenticated"})
            for role in (READER, BROKER):
                self.expect(endpoint, "GET", "fixture_public", role, 200,
                            claims={"role": "service_role"})

    def mutations(self, endpoint, standby=False):
        expected_code = "0A000" if standby else "25006"
        for role in (AUTHENTICATED, *SERVICE_ROLES, READER):
            for method, path, data in (
                ("POST", "fixture_public", {"id": 2, "value": "blocked"}),
                ("PATCH", "fixture_public?id=eq.1", {"value": "blocked"}),
                ("DELETE", "fixture_public?id=eq.1", None),
                ("PUT", "fixture_public?id=eq.1", {"id": 1, "value": "blocked"}),
                ("POST", "rpc/fixture_write", {}),
                ("POST", "rpc/fixture_read_volatile", {}),
            ):
                self.error(endpoint, method, path, role, expected_code, data=data)
        # On GET PostgREST starts READ ONLY; the invoker hook freezes that
        # transaction before even an owner-level nested definer attempts escape.
        if not standby:
            for path in ("rpc/fixture_escape", "rpc/fixture_escape_nested", "rpc/fixture_next_sequence"):
                self.error(endpoint, "GET", path, AUTHENTICATED, "25006")

    def setup(self):
        require("12.2.8" in self.docker("run", "--rm", REST_IMAGE, "/bin/postgrest", "--version"),
                "PostgREST version mismatch")
        self.docker("network", "create", "--internal", self.name)
        self.network_created = True
        self.launch(self.primary, PG_IMAGE, "--tmpfs", "/var/lib/postgresql/data", env=(
            "POSTGRES_HOST_AUTH_METHOD=trust", f"POSTGRES_DB={DATABASE}",
        ))
        self.wait(lambda: self.docker("exec", self.primary, "pg_isready", "-h", "127.0.0.1", "-U", "postgres")
                  .endswith("accepting connections"), "PostgreSQL")
        require(self.sql("SHOW server_version;").startswith("17.4"), "PostgreSQL version mismatch")
        self.sql((Path(__file__).with_name("fixture.sql")).read_text())
        if BAN_SOURCE:
            source = (ROOT / "supabase/migrations" / BAN_SOURCE).read_text()
            start = source.index("CREATE OR REPLACE FUNCTION public.enforce_request_user_ban()")
            end = source.index("NOTIFY pgrst, 'reload config';", start)
            self.sql(source[start:end])
        self.sql((ROOT / "supabase/migrations" / READER_MIGRATION).read_text())
        self.sql((ROOT / "supabase/migrations" / PREDECESSOR).read_text())
        self.sql(f"ALTER ROLE {AUTHENTICATOR} SET default_transaction_read_only=on;")
        self.docker("exec", self.primary, "sh", "-c",
                    'echo "host replication all all trust" >> "$PGDATA/pg_hba.conf"')
        self.sql("SELECT pg_reload_conf();")
        name = self.standby
        self.docker("run", "--rm", "-d", "--name", name, "--network", self.name,
                    "--user", "postgres", "--tmpfs", "/tmp", PG_IMAGE, "sh", "-c",
                    f"pg_basebackup -h {self.primary} -U postgres -D /tmp/replica -R -X stream && "
                    "exec postgres -D /tmp/replica")
        self.containers.append(name)
        self.wait(lambda: self.sql("SELECT pg_is_in_recovery();", standby=True) == "t", "streaming standby")

    def close(self):
        for name in reversed(self.containers):
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20)
        if self.network_created:
            subprocess.run(["docker", "network", "rm", self.name], capture_output=True, timeout=20)

    def run(self, args):
        self.setup()
        readonly = self.api("readonly", self.standby)
        primary = self.api("primary-api", self.primary, hook=False)
        self.credential_reads(readonly)
        self.credential_reads(primary)
        self.allowed_reads(readonly, True)
        print("PASS baseline: service credentials readable through old readonly hook and primary", flush=True)
        if args.expect_denied_old_hook:
            self.credential_reads(readonly, denied=True)
        if args.baseline_only:
            return
        self.mutations(readonly, standby=True)
        # BEGIN READ WRITE errors may discard the pool. Rewarm before recording it.
        time.sleep(1)
        before = self.expect(readonly, "GET", "rpc/fixture_backend", AUTHENTICATED, 200)
        grants = self.grants()
        migration = (ROOT / "supabase/migrations" / SUCCESSOR).read_text()
        rollback = (ROOT / ROLLBACK).read_text()
        self.sql("CREATE DATABASE fixture_wrong;")
        self.sql(migration, database="fixture_wrong", fail=True)
        require(self.sql(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{VERSION}';") == "0",
                "wrong database apply left a receipt")
        # A body collision must fail without installing the successor receipt.
        old_definition = self.sql("SELECT pg_get_functiondef('postgrest_readonly.pre_request()'::regprocedure);")
        self.sql("CREATE OR REPLACE FUNCTION postgrest_readonly.pre_request() RETURNS void LANGUAGE plpgsql "
                 "VOLATILE SECURITY INVOKER SET search_path TO pg_catalog AS $$ BEGIN NULL; END; $$;")
        self.sql(migration, fail=True)
        require(self.sql(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{VERSION}';") == "0",
                "drifted predecessor left a receipt")
        self.sql(old_definition)
        self.sql(migration)
        self.wait(lambda: self.http(readonly, "GET", "guild_config?select=client_secret", SERVICE_ROLES[0])[0] == 403,
                  "successor WAL replay")
        self.credential_reads(readonly, denied=True)
        self.credential_reads(primary)
        require(self.grants() == grants, "successor changed role memberships or public table/column grants")
        print("PASS successor: actual WAL replay denies GET/HEAD/stable/definer credential paths; primary remains allowed", flush=True)
        new_definition = self.sql("SELECT pg_get_functiondef('postgrest_readonly.pre_request()'::regprocedure);")
        self.sql("CREATE OR REPLACE FUNCTION postgrest_readonly.pre_request() RETURNS void LANGUAGE plpgsql "
                 "VOLATILE SECURITY INVOKER SET search_path TO pg_catalog AS $$ BEGIN NULL; END; $$;")
        self.sql(rollback, fail=True)
        require(self.sql(f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{VERSION}';") == "1",
                "drifted rollback removed the receipt")
        self.sql(new_definition)
        self.sql(rollback)
        self.wait(lambda: self.http(readonly, "GET", "guild_config?select=client_secret", SERVICE_ROLES[0])[0] == 200,
                  "rollback WAL replay")
        self.credential_reads(readonly)
        self.sql(migration)
        self.wait(lambda: self.http(readonly, "GET", "guild_config?select=client_secret", SERVICE_ROLES[0])[0] == 403,
                  "reapply WAL replay")
        print("PASS lifecycle: wrong database/body drift rejected; real rollback restores access; reapply denies", flush=True)
        self.allowed_reads(readonly, True)
        self.claim_mapping(readonly)
        # Confirm every expected transaction-mode refusal on the real standby.
        self.mutations(readonly, standby=True)
        time.sleep(1)
        before = self.expect(readonly, "GET", "rpc/fixture_backend", AUTHENTICATED, 200)
        self.docker("exec", "-u", "postgres", self.standby, "pg_ctl", "-D", "/tmp/replica", "-w", "promote")
        self.wait(lambda: self.sql("SELECT pg_is_in_recovery();", standby=True) == "f", "promotion")
        after = self.expect(readonly, "GET", "rpc/fixture_backend", AUTHENTICATED, 200)
        require(before["pid"] == after["pid"], "promotion did not reuse the warmed backend")
        require(after["readonly"] == "on", "promoted GET was not read only")
        self.credential_reads(readonly, denied=True)
        self.allowed_reads(readonly, False)
        self.claim_mapping(readonly)
        self.mutations(readonly)
        self.expect(readonly, "GET", "fixture_public", READER, 200, [{"id": 1, "value": "original"}])
        require(self.sql("SELECT count(*) FROM fixture_public; SELECT is_called FROM fixture_seq;", standby=True) == "1\nf",
                "a prohibited mutation changed fixture state")
        self.expect(primary, "POST", "fixture_public", SERVICE_ROLES[0], 201,
                    data={"id": 3, "value": "primary-write"})
        self.credential_reads(primary)
        require(self.grants() == grants, "lifecycle changed role memberships or public grants")
        print(f"PASS promotion: same pooled PID {after['pid']}; mapped callers, readers, primary writes and mutation refusals preserved", flush=True)
        print(f"PASS {self.checks} real HTTP assertions (PostgreSQL 17.4 / PostgREST 12.2.8)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-only", action="store_true")
    parser.add_argument("--expect-denied-old-hook", action="store_true",
                        help="red control: expect the old hook to deny service credentials")
    arguments = parser.parse_args()
    fixture = Fixture()
    try:
        fixture.run(arguments)
    finally:
        fixture.close()
