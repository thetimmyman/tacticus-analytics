'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@tacticus/ui-kit'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Palette,
  Rocket,
  Shield,
  UserCheck,
  Users,
  X
} from 'lucide-react'

import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('clusters.create.ClusterCreationWizard')
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog'
import { InlineAlert } from '@/app/components/ui/InlineAlert'

import type { ClusterData, ClusterSetupMethod } from './_lib/cluster-types'
import { StepBasicInfo } from './_components/StepBasicInfo'
import { StepBranding } from './_components/StepBranding'
import { StepDiscord } from './_components/StepDiscord'
import { StepSettings } from './_components/StepSettings'
import { StepSetupMethod } from './_components/StepSetupMethod'
import { StepReview } from './_components/StepReview'

const STEPS = [
  { id: 1, title: 'Basic Information', icon: Shield },
  { id: 2, title: 'Branding (Optional)', icon: Palette, optional: true },
  { id: 3, title: 'Discord (Optional)', icon: MessageSquare, optional: true },
  { id: 4, title: 'Cluster Settings', icon: Users },
  { id: 5, title: 'Guild Setup Method', icon: UserCheck },
  { id: 6, title: 'Review & Create', icon: Rocket }
]

interface ClusterCreationResponse {
  cluster: Record<string, unknown>
  inviteCode?: string
  setupMethod: ClusterSetupMethod
  error?: string
}

type ClusterCreationSummary = ClusterCreationResponse['cluster'] & {
  inviteCode?: string
  setupMethod: ClusterSetupMethod
}

interface ClusterCreationWizardProps {
  onClusterCreated?: (cluster: ClusterCreationSummary) => void
  onCancel?: () => void
}

export default function ClusterCreationWizard({
  onClusterCreated,
  onCancel
}: ClusterCreationWizardProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [skipBranding, setSkipBranding] = useState(false)
  const [skipDiscord, setSkipDiscord] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Never auto-dismiss success: for invite-code setups the dialog first shows the code.
  const [successInfo, setSuccessInfo] = useState<{
    message: string
    proceed: () => void
  } | null>(null)
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)
  const [successProceedStarted, setSuccessProceedStarted] = useState(false)
  const successProceedStartedRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [clusterData, setClusterData] = useState<ClusterData>({
    clusterCode: '',
    displayName: '',
    tagline: '',
    description: '',
    timezone: 'UTC',
    primaryLanguage: 'en',
    primaryColor: '#DC143C', // Horus Heresy Crimson
    secondaryColor: '#FFD700', // Horus Heresy Gold
    accentColor: '#FF6347', // Horus Heresy Tomato Red
    logoUrl: '',
    bannerUrl: '',
    discordServerId: '',
    discordInviteUrl: '',
    discordWebhookUrl: '',
    maxGuilds: 10,
    tokenOffenderThreshold: 10,
    tokenAbuserThreshold: 15,
    setupMethod: 'direct',
    generateInviteCode: false,
    foundingGuilds: []
  })

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {}

    switch (step) {
      case 1:
        if (!clusterData.clusterCode)
          newErrors.clusterCode = 'Cluster code is required'
        if (
          clusterData.clusterCode &&
          !/^[A-Z0-9]{2,10}$/.test(clusterData.clusterCode)
        ) {
          newErrors.clusterCode = 'Code must be 2-10 uppercase letters/numbers'
        }
        if (!clusterData.displayName)
          newErrors.displayName = 'Display name is required'
        break

      case 2:
        break

      case 3:
        if (
          clusterData.discordInviteUrl &&
          !clusterData.discordInviteUrl.includes('discord')
        ) {
          newErrors.discordInviteUrl = 'Invalid Discord invite URL'
        }
        if (
          clusterData.discordWebhookUrl &&
          !clusterData.discordWebhookUrl.includes('discord')
        ) {
          newErrors.discordWebhookUrl = 'Invalid Discord webhook URL'
        }
        break

      case 4:
        if (clusterData.maxGuilds < 1)
          newErrors.maxGuilds = 'Must allow at least 1 guild'
        if (clusterData.maxGuilds > 100)
          newErrors.maxGuilds = 'Maximum 100 guilds'
        break

      case 5:
        break
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep === 2 && skipBranding) {
        setCurrentStep(3)
      } else if (currentStep === 3 && skipDiscord) {
        setCurrentStep(4)
      } else if (currentStep < STEPS.length) {
        setCurrentStep(currentStep + 1)
      }
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    } else if (onCancel) {
      onCancel()
    }
  }

  const handleCreate = async () => {
    setLoading(true)
    setSubmitError(null)

    try {
      const clusterPayload = {
        clusterCode: clusterData.clusterCode,
        displayName: clusterData.displayName,
        tagline: clusterData.tagline,
        description: clusterData.description,
        timezone: clusterData.timezone,
        primaryLanguage: clusterData.primaryLanguage,
        primaryColor: clusterData.primaryColor,
        secondaryColor: clusterData.secondaryColor,
        accentColor: clusterData.accentColor,
        logoUrl: clusterData.logoUrl,
        bannerUrl: clusterData.bannerUrl,
        discordServerId: clusterData.discordServerId,
        discordInviteUrl: clusterData.discordInviteUrl,
        discordWebhookUrl: clusterData.discordWebhookUrl,
        maxGuilds: clusterData.maxGuilds,
        tokenOffenderThreshold: clusterData.tokenOffenderThreshold,
        tokenAbuserThreshold: clusterData.tokenAbuserThreshold,
        setupMethod: clusterData.setupMethod,
        generateInviteCode: clusterData.generateInviteCode,
        foundingGuilds: clusterData.foundingGuilds
      }

      const response = await fetch('/api/clusters/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(clusterPayload)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(extractErrorMessage(result, 'Failed to create cluster'))
      }

      const setupMethod = result.setupMethod ?? clusterData.setupMethod

      logger.info(
        {
          clusterCode: clusterData.clusterCode,
          setupMethod,
          hasInviteCode: Boolean(result.inviteCode)
        },
        'Cluster created successfully'
      )

      const successMessage =
        setupMethod === 'invite_code'
          ? `Cluster ${clusterData.clusterCode} created! Invite code: ${result.inviteCode}`
          : `Cluster ${clusterData.clusterCode} created with ${clusterData.foundingGuilds.length} founding guilds!`

      successProceedStartedRef.current = false
      setSuccessProceedStarted(false)
      setSuccessInfo({
        message: successMessage,
        proceed: () => {
          if (onClusterCreated) {
            const clusterSummary: ClusterCreationSummary = {
              ...(result.cluster ?? {}),
              inviteCode: result.inviteCode,
              setupMethod
            }
            onClusterCreated(clusterSummary)
          } else {
            router.push(`/leaderboards?cluster=${clusterData.clusterCode}`)
          }
        }
      })
      setSuccessDialogOpen(true)
    } catch (error: unknown) {
      logger.error({ err: error }, 'Error creating cluster:')
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setSubmitError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleSuccessProceed = () => {
    if (!successInfo || successProceedStartedRef.current) return

    successProceedStartedRef.current = true
    setSuccessProceedStarted(true)
    setSuccessDialogOpen(false)
    successInfo.proceed()
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepBasicInfo
            data={clusterData}
            setData={setClusterData}
            errors={errors}
          />
        )
      case 2:
        return (
          <StepBranding
            data={clusterData}
            setData={setClusterData}
            skipBranding={skipBranding}
            setSkipBranding={setSkipBranding}
          />
        )
      case 3:
        return (
          <StepDiscord
            data={clusterData}
            setData={setClusterData}
            errors={errors}
            skipDiscord={skipDiscord}
            setSkipDiscord={setSkipDiscord}
          />
        )
      case 4:
        return (
          <StepSettings
            data={clusterData}
            setData={setClusterData}
            errors={errors}
          />
        )
      case 5:
        return <StepSetupMethod data={clusterData} setData={setClusterData} />
      case 6:
        return <StepReview data={clusterData} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          const isActive = step.id === currentStep
          const isCompleted = step.id < currentStep
          const isSkipped =
            (step.id === 2 && skipBranding && currentStep > 2) ||
            (step.id === 3 && skipDiscord && currentStep > 3)

          return (
            <div key={step.id} className="flex items-center flex-1">
              <div
                className={`
                flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all
                ${isActive ? 'border-amber-500 bg-amber-500 text-[var(--bg-primary)]' : ''}
                ${isCompleted || isSkipped ? 'border-green-500 bg-green-500 text-[var(--text-primary)]' : ''}
                ${!isActive && !isCompleted && !isSkipped ? 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]' : ''}
              `}
              >
                {isCompleted || isSkipped ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 px-2">
                <div
                  className={`text-sm ${isActive ? 'text-yellow-500' : 'text-[var(--text-secondary)]'}`}
                >
                  {step.title}
                </div>
              </div>
              {index < STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
              )}
            </div>
          )
        })}
      </div>

      {/* Step Content */}
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-6 min-h-[400px]">
        {renderStepContent()}
      </div>

      {submitError && (
        <InlineAlert
          tone="danger"
          title="Failed to create cluster"
          role="alert"
        >
          {submitError}
        </InlineAlert>
      )}

      {/* Persistent copy: the dismissible dialog may be the only place the invite code shows. */}
      {successInfo && (
        <InlineAlert
          tone="success"
          title="Cluster created"
          action={
            !successDialogOpen ? (
              <Button
                type="button"
                onClick={handleSuccessProceed}
                disabled={successProceedStarted}
              >
                {successProceedStarted ? 'Continuing...' : 'Continue'}
              </Button>
            ) : undefined
          }
        >
          <span className="whitespace-pre-line">{successInfo.message}</span>
        </InlineAlert>
      )}

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <Button
          onClick={handleBack}
          disabled={currentStep === 1 && !onCancel}
          variant="outline"
        >
          {currentStep === 1 && onCancel ? (
            <>
              <X className="w-4 h-4 mr-2" />
              Cancel
            </>
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </>
          )}
        </Button>

        {currentStep < STEPS.length ? (
          <Button onClick={handleNext}>
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleCreate}
            disabled={loading || successInfo !== null}
            className="bg-green-600 hover:bg-green-700"
          >
            {loading
              ? 'Creating...'
              : successInfo
                ? 'Cluster Created'
                : 'Create Cluster'}
            <Rocket className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={successInfo !== null && successDialogOpen}
        title="Cluster created"
        description={
          <span className="whitespace-pre-line">{successInfo?.message}</span>
        }
        confirmLabel="Continue"
        cancelLabel="Stay here"
        onCancel={() => setSuccessDialogOpen(false)}
        onConfirm={handleSuccessProceed}
      />
    </div>
  )
}
