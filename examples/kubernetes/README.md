# Kubernetes web example

This deploys the Next.js web tier only. Workers, scheduled jobs and the Supabase edge runtime are out of scope; Supabase remains external.

## The app is bound to its own identity

The build and the container's start command both run `scripts/dev/verify-app-identity.mjs`. It accepts only the site and API hosts listed in `.app-identity.json` for `NEXT_PUBLIC_SITE_URL`, `SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` and `SUPABASE_INTERNAL_URL`. Any other host stops the build or the container. The auth session cookie is also scoped to the production domain. The example therefore uses the project's own hosts. Running under another domain would need code changes, and the licence grants no right to do that (see `LICENSE`).

## What you provide

- A Kubernetes cluster.
- Access to the Supabase project behind the API host.
- The runtime secrets.
- An image in a registry you control. The published image is not publicly pullable.

## Build and push the image

The `NEXT_PUBLIC_*` values are baked in at build time:

```bash
docker build -f docker/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://api.tacticusanalytics.com \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  --build-arg NEXT_PUBLIC_SITE_URL=https://www.tacticusanalytics.com \
  --build-arg GITHUB_REPOSITORY=thetimmyman/tacticus-analytics \
  -t registry.example.com/tacticus-analytics-web:REPLACE_WITH_IMMUTABLE_TAG .
docker push registry.example.com/tacticus-analytics-web:REPLACE_WITH_IMMUTABLE_TAG
```

Set the image in `deployment.yaml` to the immutable tag you pushed.

## Create the runtime Secret

Create the Secret out of band:

```bash
kubectl create secret generic tacticus-analytics-runtime \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=CRON_SECRET="$(openssl rand -hex 32)" \
  --from-literal=HEALTH_CHECK_SECRET="$(openssl rand -hex 32)" \
  --from-literal=LOKI_SCRAPER_CLIENT_SECRET=your-loki-client-secret
```

Alternatively, use `--from-env-file` with a git-ignored file containing those values.

`secret.example.yaml` shows the shape only. `kustomization.yaml` deliberately leaves it out, so `kubectl apply -k` never overwrites the real Secret with placeholders.

Set the anon key and `LOKI_SCRAPER_USER_ID` in `configmap.yaml`. The Loki user id and client secret are required for guild onboarding (`/api/guild/create-config` refuses without them). The `NEXT_PUBLIC_*` values there affect only server-side reads; the browser bundle uses the values baked in at build time, so keep both in step.

## Apply

Render and apply the configuration, then wait for the rollout:

```bash
kubectl kustomize examples/kubernetes
kubectl apply -k examples/kubernetes
kubectl rollout status deployment/tacticus-analytics-web
kubectl port-forward service/tacticus-analytics-web 8080:80
```

`http://localhost:8080` then serves the public pages. Signing in needs the production site host, because the OAuth redirects and the session cookie are bound to it. Route that host to the Service with an Ingress, a Gateway or a tunnel.

## Probes and flags

- **Probes** use `/api/health/process`. It reports only that the Node process is serving and needs no credentials.
- **`/api/health`** is public too and always returns HTTP 200. Without the `HEALTH_CHECK_SECRET` bearer it returns a sanitized snapshot, and with the bearer it returns the full one. It is not a kubelet probe.
- **`DEPLOYMENT_ENV`** is left unset. `DEPLOYMENT_ENV=self-hosted` turns on Docker, disk, nginx, tunnel and PostgREST probes and the extreme-memory auto-shutdown, which assume infrastructure this example does not create.
