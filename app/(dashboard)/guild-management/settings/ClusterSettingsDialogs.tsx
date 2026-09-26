import { Shield } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import type { ReactNode } from 'react'
import ClusterCreationWizard from '@/app/(dashboard)/clusters/create/ClusterCreationWizard'
import GuildJoinFlow from '@/app/components/clusters/GuildJoinFlow'

interface ClusterSettingsDialogsProps {
  showCreate: boolean
  showJoin: boolean
  onCloseCreate: () => void
  onCloseJoin: () => void
  onClusterCreated: (created: Record<string, unknown>) => void
}

function DialogFrame({
  title,
  sizeClass,
  onClose,
  children
}: {
  title: string
  sizeClass: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className={`w-full ${sizeClass} overflow-hidden rounded-3xl border border-card-border/60 bg-[var(--bg-primary)] shadow-[0_30px_60px_rgba(4,8,20,0.65)]`}
      >
        <div className="flex items-center justify-between border-b border-card-border/50 px-6 py-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="rounded-xl px-3"
          >
            <Shield className="h-5 w-5 text-[var(--text-secondary)]" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

export function ClusterSettingsDialogs({
  showCreate,
  showJoin,
  onCloseCreate,
  onCloseJoin,
  onClusterCreated
}: ClusterSettingsDialogsProps) {
  return (
    <>
      {showCreate && (
        <DialogFrame
          title="Create new cluster"
          sizeClass="max-w-4xl"
          onClose={onCloseCreate}
        >
          <ClusterCreationWizard
            onClusterCreated={onClusterCreated}
            onCancel={onCloseCreate}
          />
        </DialogFrame>
      )}

      {showJoin && (
        <DialogFrame
          title="Join existing cluster"
          sizeClass="max-w-2xl"
          onClose={onCloseJoin}
        >
          <GuildJoinFlow
            onJoinSuccess={() => {
              onCloseJoin()
              window.location.reload()
            }}
            onCancel={onCloseJoin}
          />
        </DialogFrame>
      )}
    </>
  )
}
