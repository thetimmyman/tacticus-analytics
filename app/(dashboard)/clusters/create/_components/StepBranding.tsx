'use client'

import { Input, Label } from '@tacticus/ui-kit'

import type { BrandingStepProps } from '../_lib/cluster-types'

export function StepBranding({
  data,
  setData,
  skipBranding,
  setSkipBranding
}: BrandingStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          Branding & Customization
        </h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={skipBranding}
            onChange={(e) => setSkipBranding(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-[var(--text-secondary)]">
            Skip this step
          </span>
        </label>
      </div>

      {!skipBranding && (
        <>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-sm text-[var(--accent)]">
              <strong>Optional:</strong> Customize your cluster&apos;s visual
              identity. You can always update these later.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Primary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.primaryColor}
                  onChange={(e) =>
                    setData({ ...data, primaryColor: e.target.value })
                  }
                  className="w-20 h-10 rounded cursor-pointer"
                />
                <Input
                  value={data.primaryColor}
                  onChange={(e) =>
                    setData({ ...data, primaryColor: e.target.value })
                  }
                  placeholder="#dc2626"
                  maxLength={7}
                />
              </div>
            </div>

            <div>
              <Label>Secondary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.secondaryColor}
                  onChange={(e) =>
                    setData({ ...data, secondaryColor: e.target.value })
                  }
                  className="w-20 h-10 rounded cursor-pointer"
                />
                <Input
                  value={data.secondaryColor}
                  onChange={(e) =>
                    setData({ ...data, secondaryColor: e.target.value })
                  }
                  placeholder="#fbbf24"
                  maxLength={7}
                />
              </div>
            </div>

            <div>
              <Label>Accent Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.accentColor}
                  onChange={(e) =>
                    setData({ ...data, accentColor: e.target.value })
                  }
                  className="w-20 h-10 rounded cursor-pointer"
                />
                <Input
                  value={data.accentColor}
                  onChange={(e) =>
                    setData({ ...data, accentColor: e.target.value })
                  }
                  placeholder="#991b1b"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          <div>
            <Label>Logo URL</Label>
            <Input
              value={data.logoUrl}
              onChange={(e) => setData({ ...data, logoUrl: e.target.value })}
              placeholder="https://example.com/logo.png"
            />
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              URL to your cluster&apos;s logo image
            </p>
          </div>

          <div>
            <Label>Banner URL</Label>
            <Input
              value={data.bannerUrl}
              onChange={(e) => setData({ ...data, bannerUrl: e.target.value })}
              placeholder="https://example.com/banner.jpg"
            />
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              URL to your cluster&apos;s banner image
            </p>
          </div>

          {/* Preview */}
          <div className="border border-[var(--card-border)] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">
              Preview
            </h3>
            <div
              className="p-4 rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${data.primaryColor} 0%, ${data.secondaryColor} 100%)`
              }}
            >
              <div className="bg-black/50 backdrop-blur p-4 rounded">
                {data.logoUrl && (
                  <img src={data.logoUrl} alt="Logo" className="h-12 mb-2" />
                )}
                <h3 className="text-[var(--text-primary)] text-lg font-bold">
                  {data.displayName || 'Cluster Name'}
                </h3>
                <p className="text-white/80 text-sm">
                  {data.tagline || 'Your tagline here'}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
