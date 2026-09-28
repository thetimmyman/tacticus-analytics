/** @type {import('next').NextConfig} */

// Skip tsc in Docker builds; CI already type-checks the same tree.
const skipTypeCheckInDocker =
  process.env.STANDALONE_BUILD === 'true' ||
  process.env.SKIP_TYPECHECK_IN_DOCKER === 'true';

const resolveSupabaseHost = () => {
  const rawUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
};

const supabaseHost = resolveSupabaseHost();
const supabaseStoragePattern = supabaseHost
  ? [
      {
        protocol: "https",
        hostname: supabaseHost,
        port: "",
        pathname: "/storage/v1/object/**",
      },
    ]
  : [];

// The optimizer fetches from inside the cluster, where the public Supabase host
// hairpins past its timeout, so the internal origin is allowed too. The literal
// is a fallback: `images` is serialized at build time, SUPABASE_URL is runtime-only.
const internalSupabaseStoragePattern = (() => {
  try {
    const url = new URL(process.env.SUPABASE_URL || "http://supabase-kong:8000");
    return [
      {
        protocol: url.protocol.replace(":", ""),
        hostname: url.hostname,
        port: url.port || "",
        pathname: "/storage/v1/object/**",
      },
    ];
  } catch {
    return [];
  }
})();

const enableRuntimePatch = process.env.ENABLE_RUNTIME_PATCH !== "false";

const nextConfig = {
  typescript: {
    ignoreBuildErrors: skipTypeCheckInDocker,
  },
  // Keep Node-only packages out of the bundler; they resolve via real require at runtime.
  serverExternalPackages: ['ioredis'],
  turbopack: {
    root: __dirname,
    // global-config.ts uses a dynamic fs.stat(), which is safe because it is server-only.
  },
  output: process.env.STANDALONE_BUILD === "true" ? "standalone" : undefined,
  // Images are served from Supabase storage, not the standalone output.
  outputFileTracingExcludes: {
    "*": [
      "data/game-data/native/**",
      "docs/**",
      "tests/**",
      "data/guild war csv files/**",
      "data/loki-api/**",
      "data/logs/**",
      "data/raw-api/**",
      "scripts/**",
      "monitoring/**",
      ".claude/**",
    ],
  },

  images: {
    loader: "default",
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 365, // 1 year
    dangerouslyAllowSVG: false,
    // Needed because the internal Supabase origin is a private address.
    // remotePatterns is still checked first, so this does not open arbitrary private fetching.
    dangerouslyAllowLocalIP: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      ...supabaseStoragePattern,
      ...internalSupabaseStoragePattern,
      {
        protocol: "https",
        hostname: "cdn.tacticusanalytics.com",
        port: "",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        port: "",
        pathname: "/unrstuart/datamine_tacticus/**",
      },
    ],
  },

  compress: true,
  poweredByHeader: false,

  experimental: {
    // One process per CPU by default; cap it to bound memory on shared CI hosts.
    // Pinned by tests/unit/config/vitest-capacity.test.ts.
    cpus: 2,

    optimizeCss: true,
    scrollRestoration: true,

    serverSourceMaps: false,

    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "@tanstack/react-query",
    ],
  },

  // Turbopack's maps are unusable for bundle attribution; `npm run analyze` is map-free.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          // CSP is set by middleware (nonce support).
        ],
      },
      {
        source: "/:path*.css",
        headers: [
          {
            key: "Content-Type",
            value: "text/css",
          },
        ],
      },
      // Stable within a game build: serve a day fresh and revalidate in the background.
      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  assetPrefix: process.env.CODESPACES
    ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : "",

  // Inert under Turbopack: this webpack hook does not run.
  webpack: (config, { isServer, webpack }) => {
    if (isServer && enableRuntimePatch) {
      try {
        class PatchServerRuntimeChunkLoaderPlugin {
          apply(compiler) {
            compiler.hooks.compilation.tap(
              "PatchServerRuntimeChunkLoaderPlugin",
              (compilation) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: "PatchServerRuntimeChunkLoaderPlugin",
                    stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
                  },
                  (assets) => {
                    Object.keys(assets).forEach((assetName) => {
                      if (!assetName.endsWith("webpack-runtime.js")) {
                        return;
                      }

                      const originalSource = assets[assetName].source().toString();
                      const injectionTarget =
                        'installChunk(require("./" + __webpack_require__.u(chunkId)));';

                      if (!originalSource.includes(injectionTarget)) {
                        return;
                      }

                      const patchedSource = originalSource.replace(
                        injectionTarget,
                        `try {
installChunk(require("./" + __webpack_require__.u(chunkId)));
} catch (runtimeChunkLoadError) {
installChunk(require("./chunks/" + __webpack_require__.u(chunkId)));
}`,
                      );

                      compilation.updateAsset(
                        assetName,
                        new webpack.sources.RawSource(patchedSource),
                      );
                    });
                  },
                );
              },
            );
          }
        }

        config.plugins.push(new PatchServerRuntimeChunkLoaderPlugin());
      } catch (runtimePatchError) {
        console.warn("Runtime chunk loader patch disabled", runtimePatchError);
      }
    }
    return config;
  },
};

module.exports = nextConfig;

const { withSentryConfig } = require("@sentry/nextjs/config");

module.exports = withSentryConfig(module.exports, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  sentryUrl: process.env.SENTRY_URL, // GlitchTip instance URL for source map uploads
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,

  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  widenClientFileUpload: true,

  // No tunnelRoute: app/monitoring/route.ts fans envelopes out to Sentry and GlitchTip.
  // Inert under Turbopack: this webpack tree-shaking does not run.
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
