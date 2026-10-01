# Private Linux preview packaging

The preview creates an installation-local account and synthetic sample workspace
through a graphical first-run form. It then signs in through the existing
application API and opens the existing player-performance page. Real raid imports,
password recovery, full feature parity and release approval remain outstanding.
Interrupted setup can resume with the original password. Completion is recorded
in the same database transaction as the synthetic import; retries preserve the
existing native account and never replace data or import the sample twice.
The repository's proprietary license is unchanged.

`stage-linux.mjs` accepts a private JSON configuration with absolute paths for
`output`, `application`, `postgres`, `node`, `electron`, `auth` and `postgrest`.
`application` is the staged desktop standalone build, `postgres` is a relocatable
PostgreSQL installation, `node` and `postgrest` are executable files, and the
remaining runtime inputs are directories. Output must be new. The resulting
`launch` executable uses only bundled application code and runtimes. No checkout,
Node installation, package manager or environment file is required at launch.

For the PostgreSQL candidate, download the official 18.6 source archive and verify
its upstream SHA-256, then build `Dockerfile.postgres` using that archive as the
build context. Docker is a developer build tool, not a consumer dependency. The
pinned Ubuntu 22.04 builder targets glibc 2.35 and omits optional ICU, readline and
compression libraries. This build covers the current local read journey; it does
not claim support for every hosted extension or database feature.

The GUI still requires ordinary operating-system display libraries. Package and
test those dependencies per supported distribution before claiming portability.
The current launcher requires a Wayland session on Linux x64. `build-deb.mjs`
accepts the absolute staged-bundle path and a new private output-directory path;
it builds a Debian preview package with a graphical application entry and declared
OS dependencies. Successful extraction and an isolated launch do not establish
installation compatibility on Ubuntu or Debian. The preview must remain private
until target-system installation and bundled-component notices are reviewed.
Verification mode uses a private `--verify` JSON file containing a throwaway
password, screenshot path and evidence path; it drives the same first-run form
and real application login route. It is not a separate mock backend.
