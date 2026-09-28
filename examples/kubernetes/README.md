# Kubernetes web example

This deploys the Next.js web tier only. Workers, scheduled jobs and the Supabase edge runtime are out of scope; Supabase remains external.

You provide a Kubernetes cluster, an external Supabase project, runtime secrets, and an image in a registry you control. The published image is not publicly pullable.

Build and push the production image with your own public Supabase values baked in as build arguments:

```bash
docker build -f docker/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://project.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.com \
  --build-arg GITHUB_REPOSITORY=thetimmyman/tacticus-analytics \
  -t registry.example.com/tacticus-analytics-web:REPLACE_WITH_IMMUTABLE_TAG .
docker push registry.example.com/tacticus-analytics-web:REPLACE_WITH_IMMUTABLE_TAG
```

Set the image in `deployment.yaml` to the immutable tag you pushed. Create the runtime Secret out of band; keep its source file git-ignored:

```bash
kubectl create secret generic tacticus-analytics-runtime \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=CRON_SECRET="$(openssl rand -hex 32)" \
  --from-literal=HEALTH_CHECK_SECRET="$(openssl rand -hex 32)"
```

Alternatively, use `--from-env-file` with a git-ignored file containing those runtime values. `secret.example.yaml` shows the shape only; `kustomization.yaml` deliberately does not include it, so `kubectl apply -k` never overwrites the real Secret with placeholders.

Edit `configmap.yaml` for your Supabase project and site URL. The `NEXT_PUBLIC_*` values there only affect server-side reads; the browser bundle uses the values baked in at build time, so keep both in step.

Render and apply the public configuration, then wait for rollout:

```bash
kubectl kustomize examples/kubernetes
kubectl apply -k examples/kubernetes
kubectl rollout status deployment/tacticus-analytics-web
kubectl port-forward service/tacticus-analytics-web 8080:80
```

Open `http://localhost:8080` after the rollout completes.

The probes use `/api/health/process`, which reports only that the Node process is serving and needs no credentials. `/api/health` needs `HEALTH_CHECK_SECRET` and is not a kubelet probe. `DEPLOYMENT_ENV` is left unset: `DEPLOYMENT_ENV=self-hosted` turns on probes for nginx, a tunnel and backups that this example does not create.
