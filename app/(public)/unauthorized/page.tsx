import Link from 'next/link'
import { MechanicusErrorLayout } from '@/app/components/error/MechanicusErrorLayout'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Access Denied',
  description:
    'Authorization error page for missing guild, cluster, role, or feature access in Tacticus Analytics.',
  path: '/unauthorized'
})

export default async function UnauthorizedPage({
  searchParams
}: {
  searchParams: Promise<{
    required?: string
    error?: string
    reason?: string
    feature?: string
    current?: string
    cluster?: string
  }>
}) {
  const resolvedSearchParams = await searchParams
  const requiredRole = resolvedSearchParams.required
  const currentRole = resolvedSearchParams.current
  const error = resolvedSearchParams.error
  const reason = resolvedSearchParams.reason
  const feature = resolvedSearchParams.feature
  const clusterName = resolvedSearchParams.cluster
    ? decodeURIComponent(resolvedSearchParams.cluster)
    : 'your cluster'

  const getErrorDetails = () => {
    if (reason === 'cluster-only') {
      const featureName = feature ? decodeURIComponent(feature) : 'This sanctum'
      return {
        protocol: 'PROTOCOL 403-CLUSTER-SEAL',
        errorCode: 'CLUSTER_ONLY',
        title: 'CLUSTER SANCTUM RESTRICTED',
        message: `${featureName} is sealed to those outside the ${clusterName}. Only those bearing the sacred cluster marks may enter these hallowed data-vaults.`,
        binaryCode:
          '01000011 01001100 01010101 01010011 01010100 01000101 01010010',
        binaryTranslation: 'CLUSTER'
      }
    }

    if (error === 'role_check_failed') {
      return {
        protocol: 'PROTOCOL 403-PERM-FAIL',
        errorCode: 'PERMISSION_CHECK_FAILED',
        title: 'CLEARANCE VERIFICATION FAILED',
        message:
          'The Machine Spirit could not verify your clearance level. Submit to re-authentication to restore your access privileges.',
        binaryCode:
          '01010000 01000101 01010010 01001101 01000110 01000001 01001001 01001100',
        binaryTranslation: 'PERM FAIL'
      }
    }

    if (requiredRole) {
      const roleMapping: { [key: string]: string } = {
        leader: 'ARCHMAGOS',
        officer: 'TECH-PRIEST',
        member: 'INITIATE'
      }
      const requiredTitle =
        roleMapping[requiredRole] || requiredRole.toUpperCase()
      const currentTitle = currentRole
        ? roleMapping[currentRole] || currentRole.toUpperCase()
        : 'UNVERIFIED'

      return {
        protocol: 'PROTOCOL 403-RANK-LOW',
        errorCode: 'INSUFFICIENT_RANK',
        title: 'INSUFFICIENT CLEARANCE LEVEL',
        message: `Access requires ${requiredTitle} clearance or higher. Your current designation: ${currentTitle}. Seek elevation through your Guild Hierarchy.`,
        binaryCode:
          '01010010 01000001 01001110 01001011 01001100 01001111 01010111',
        binaryTranslation: 'RANK LOW'
      }
    }

    return {
      protocol: 'PROTOCOL 403-OMEGA-FORBIDDEN',
      errorCode: 'ACCESS_DENIED',
      title: 'ACCESS FORBIDDEN',
      message:
        'The Machine Spirit has denied your access request. This data-sanctum is beyond your current authorization parameters.',
      binaryCode:
        '01000110 01001111 01010010 01000010 01001001 01000100 01000100 01000101 01001110',
      binaryTranslation: 'FORBIDDEN'
    }
  }

  const errorDetails = getErrorDetails()

  return (
    <MechanicusErrorLayout
      {...errorDetails}
      showHomeButton={false}
      showRetryButton={false}
      showLoginButton={true}
    >
      {/* Role-specific guidance */}
      {requiredRole && (
        <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-6 mb-6">
          <h3 className="text-amber-400 font-bold mb-3 text-center uppercase">
            Clearance Requirements:
          </h3>
          <ul className="text-[var(--text-secondary)] text-sm space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-1">▸</span>
              <span>
                <strong>INITIATE:</strong> Basic dashboard access and personal
                statistics
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-1">▸</span>
              <span>
                <strong>TECH-PRIEST (Officer):</strong> Token management and
                guild operations
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-1">▸</span>
              <span>
                <strong>ARCHMAGOS (Leader):</strong> Full administrative control
                and API access
              </span>
            </li>
          </ul>
        </div>
      )}

      {/* Cluster-only information */}
      {reason === 'cluster-only' && (
        <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-6 mb-6">
          <h3 className="text-red-400 font-bold mb-3 text-center uppercase">
            Cluster Sanctum Notice:
          </h3>
          <p className="text-[var(--text-secondary)] text-sm mb-4">
            This sacred data-forge is reserved for guilds bearing the mark of{' '}
            {clusterName}.
          </p>
          <div className="bg-black/50 border border-amber-900/30 rounded p-4">
            <p className="text-amber-400/80 text-sm">
              <strong>For Independent Guilds:</strong> Your guild dashboard
              tracks boss damage, token status, and guild activity. Cluster
              features require formal induction into a recognized cluster
              alliance.
            </p>
          </div>
        </div>
      )}

      {/* Access recovery steps */}
      <div className="bg-black/50 border border-red-900/30 rounded-lg p-6 mb-6">
        <h3 className="text-red-400 font-bold mb-3 text-center uppercase">
          Access Recovery Protocols:
        </h3>
        <ol className="text-[var(--text-secondary)] text-sm space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-red-400 mt-1">01.</span>
            <span>Verify your authentication status is current</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400 mt-1">02.</span>
            <span>Contact your Guild Leadership for elevation requests</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400 mt-1">03.</span>
            <span>Ensure you are accessing the correct guild portal</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-red-400 mt-1">04.</span>
            <span>
              Submit a support request if authorization should be valid
            </span>
          </li>
        </ol>
      </div>

      {/* Navigation buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/dashboard"
          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black font-bold rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg"
        >
          RETURN TO SANCTIONED ZONE
        </Link>
      </div>
    </MechanicusErrorLayout>
  )
}
