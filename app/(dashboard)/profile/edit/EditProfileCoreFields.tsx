'use client'

import type { Dispatch, SetStateAction } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  RadixSelect,
  RadixSelectTrigger,
  RadixSelectContent,
  RadixSelectItem,
  RadixSelectValue,
  RadixSelectSeparator,
  RadixSelectLabel,
  RadixSelectGroup
} from '@tacticus/ui-kit/radix-select'

interface EditProfileCoreFieldsProps {
  desktopMode?: boolean
  avatarUrl: string
  displayName: string
  saving: boolean
  timezone: string
  setTimezone: Dispatch<SetStateAction<string>>
  discordUsername: string
  setDiscordUsername: Dispatch<SetStateAction<string>>
  isDiscordUsernameControlled: boolean
  tacticusShareUrl: string
  setTacticusShareUrl: Dispatch<SetStateAction<string>>
  themePreference: string
  setThemePreference: Dispatch<SetStateAction<string>>
  applyTheme: (code: string) => Promise<{ success: boolean; error?: string }>
}

export function EditProfileCoreFields({
  desktopMode = false,
  avatarUrl,
  displayName,
  saving,
  timezone,
  setTimezone,
  discordUsername,
  setDiscordUsername,
  isDiscordUsernameControlled,
  tacticusShareUrl,
  setTacticusShareUrl,
  themePreference,
  setThemePreference,
  applyTheme
}: EditProfileCoreFieldsProps) {
  return (
    <div className="flex items-start space-x-6">
      {/* Avatar Preview */}
      <div className="shrink-0">
        <Image
          src={avatarUrl}
          alt="Profile"
          width={96}
          height={96}
          className="w-24 h-24 rounded-full"
          unoptimized
        />
        <p className="mt-2 text-xs text-secondary-wh40k text-center">
          Auto-generated
        </p>
      </div>

      {/* Form Fields */}
      <div className="flex-1 space-y-4">
        <div>
          <label
            htmlFor="displayName"
            className="block text-sm font-medium text-secondary-wh40k"
          >
            {desktopMode
              ? 'Display Name (Local Label)'
              : 'Display Name (Game Controlled)'}
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            className="input-wh40k w-full mt-1 bg-(--card-bg) opacity-60 cursor-not-allowed"
            disabled
            readOnly
          />
          <p className="mt-1 text-xs text-secondary-wh40k">
            {desktopMode
              ? 'This workspace label does not verify ownership of a game account.'
              : 'Your display name is automatically synchronized from the Tacticus game and cannot be edited here.'}
          </p>
        </div>

        <div>
          <label
            htmlFor="timezone"
            className="block text-sm font-medium text-secondary-wh40k"
          >
            Timezone
          </label>
          <RadixSelect
            value={timezone}
            onValueChange={setTimezone}
            disabled={saving}
          >
            <RadixSelectTrigger className="w-full mt-1">
              <RadixSelectValue placeholder="Select timezone..." />
            </RadixSelectTrigger>
            <RadixSelectContent>
              <RadixSelectItem value="UTC">
                Coordinated Universal Time (UTC)
              </RadixSelectItem>
              <RadixSelectItem value="America/New_York">
                Eastern Time (ET)
              </RadixSelectItem>
              <RadixSelectItem value="America/Chicago">
                Central Time (CT)
              </RadixSelectItem>
              <RadixSelectItem value="America/Denver">
                Mountain Time (MT)
              </RadixSelectItem>
              <RadixSelectItem value="America/Los_Angeles">
                Pacific Time (PT)
              </RadixSelectItem>
              <RadixSelectItem value="Europe/London">
                British Time (GMT/BST)
              </RadixSelectItem>
              <RadixSelectItem value="Europe/Paris">
                Central European Time (CET)
              </RadixSelectItem>
              <RadixSelectItem value="Asia/Tokyo">
                Japan Standard Time (JST)
              </RadixSelectItem>
              <RadixSelectItem value="Australia/Sydney">
                Australian Eastern Time (AET)
              </RadixSelectItem>
            </RadixSelectContent>
          </RadixSelect>
        </div>

        <div>
          <label
            htmlFor="discordUsername"
            className="flex items-center justify-between text-sm font-medium text-secondary-wh40k"
          >
            <span>
              {desktopMode
                ? 'Discord Display Alias (Optional)'
                : 'Discord Username'}
            </span>
            {isDiscordUsernameControlled && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-500/30">
                <svg
                  className="w-3 h-3 mr-1"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.615.874-1.266 1.226-1.963a.077.077 0 0 0-.041-.106 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.246.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.077.077 0 0 0-.041.107c.36.696.772 1.347 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
                </svg>
                Discord
              </span>
            )}
          </label>
          <input
            id="discordUsername"
            type="text"
            value={discordUsername}
            onChange={(e) => setDiscordUsername(e.target.value)}
            className={`input-wh40k w-full mt-1 ${isDiscordUsernameControlled ? 'bg-gray-800/50 cursor-not-allowed' : ''}`}
            placeholder={
              isDiscordUsernameControlled
                ? 'Managed by Discord account'
                : 'username#1234'
            }
            disabled={saving || isDiscordUsernameControlled}
            readOnly={isDiscordUsernameControlled}
          />
          {desktopMode && (
            <p className="mt-1 text-xs text-secondary-wh40k">
              A local display preference; no Discord account is linked or
              verified.
            </p>
          )}
          {isDiscordUsernameControlled && (
            <p className="mt-1 text-xs text-secondary-wh40k">
              This field is automatically synced from your connected Discord
              account.
              <Link
                href="/profile"
                className="text-(--accent) hover:underline ml-1"
              >
                Manage Discord connection
              </Link>
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="tacticusShareUrl"
            className="block text-sm font-medium text-secondary-wh40k"
          >
            Tacticus Share URL
          </label>
          <input
            id="tacticusShareUrl"
            type="url"
            value={tacticusShareUrl}
            onChange={(e) => setTacticusShareUrl(e.target.value)}
            className="input-wh40k w-full mt-1"
            placeholder="https://tacticus.com/share/..."
            disabled={saving}
          />
        </div>

        <div>
          <label
            htmlFor="themePreference"
            className="block text-sm font-medium text-secondary-wh40k"
          >
            Theme Preference
          </label>
          <RadixSelect
            value={themePreference}
            onValueChange={(newTheme) => {
              setThemePreference(newTheme)
              // Apply immediately for preview.
              applyTheme(newTheme)
            }}
            disabled={saving}
          >
            <RadixSelectTrigger className="w-full mt-1">
              <RadixSelectValue placeholder="Select theme..." />
            </RadixSelectTrigger>
            <RadixSelectContent>
              <RadixSelectItem value="guild">
                Guild Theme (Default)
              </RadixSelectItem>

              {/* Basic Themes */}
              <RadixSelectSeparator />
              <RadixSelectItem value="light">Light Theme</RadixSelectItem>
              <RadixSelectItem value="dark">Dark Theme</RadixSelectItem>

              {/* Special Themes */}
              <RadixSelectSeparator />
              <RadixSelectItem value="HORUS_HERESY">
                Horus Heresy
              </RadixSelectItem>
              <RadixSelectItem value="MECHANICUS">Mechanicus</RadixSelectItem>
              <RadixSelectItem value="IMPERIAL">Imperial</RadixSelectItem>
              <RadixSelectItem value="NECRON">Necron Dynasty</RadixSelectItem>
              <RadixSelectItem value="ELDAR">Aeldari</RadixSelectItem>

              {/* Loyalist Chapters */}
              <RadixSelectSeparator />
              <RadixSelectGroup>
                <RadixSelectLabel className="text-xs text-(--text-tertiary) px-2 py-1">
                  Loyalist Astartes
                </RadixSelectLabel>
                <RadixSelectItem value="UM">Ultramarines</RadixSelectItem>
                <RadixSelectItem value="BA">Blood Angels</RadixSelectItem>
                <RadixSelectItem value="IF">Imperial Fists</RadixSelectItem>
                <RadixSelectItem value="WS">White Scars</RadixSelectItem>
                <RadixSelectItem value="SW">Space Wolves</RadixSelectItem>
                <RadixSelectItem value="SA">Salamanders</RadixSelectItem>
                <RadixSelectItem value="IH_LOYALIST">
                  Iron Hands
                </RadixSelectItem>
                <RadixSelectItem value="CF">Crimson Fists</RadixSelectItem>
                <RadixSelectItem value="BT">Black Templars</RadixSelectItem>
                <RadixSelectItem value="RG">Raven Guard</RadixSelectItem>
                <RadixSelectItem value="DA">Dark Angels</RadixSelectItem>
              </RadixSelectGroup>

              {/* Chaos Forces */}
              <RadixSelectSeparator />
              <RadixSelectGroup>
                <RadixSelectLabel className="text-xs text-(--text-tertiary) px-2 py-1">
                  Chaos Forces
                </RadixSelectLabel>
                <RadixSelectItem value="IW">Iron Warriors</RadixSelectItem>
                <RadixSelectItem value="AL">Alpha Legion</RadixSelectItem>
                <RadixSelectItem value="HL">The Heresy Lodge</RadixSelectItem>
                <RadixSelectItem value="IH">Iron Hydras</RadixSelectItem>
                <RadixSelectItem value="TS">Thousand Sons</RadixSelectItem>
                <RadixSelectItem value="NL">Night Lords</RadixSelectItem>
                <RadixSelectItem value="BL">Black Legion</RadixSelectItem>
                <RadixSelectItem value="WE">World Eaters</RadixSelectItem>
                <RadixSelectItem value="EC">
                  Emperor&apos;s Children
                </RadixSelectItem>
                <RadixSelectItem value="WB">Word Bearers</RadixSelectItem>
                <RadixSelectItem value="DG">Death Guard</RadixSelectItem>
              </RadixSelectGroup>

              {/* Xenos */}
              <RadixSelectSeparator />
              <RadixSelectGroup>
                <RadixSelectLabel className="text-xs text-(--text-tertiary) px-2 py-1">
                  Xenos
                </RadixSelectLabel>
                <RadixSelectItem value="ORKS">Orks</RadixSelectItem>
                <RadixSelectItem value="TAU">Tau Empire</RadixSelectItem>
                <RadixSelectItem value="TYRANIDS">Tyranids</RadixSelectItem>
                <RadixSelectItem value="DRUKHARI">Drukhari</RadixSelectItem>
              </RadixSelectGroup>

              {/* Imperial Forces */}
              <RadixSelectSeparator />
              <RadixSelectGroup>
                <RadixSelectLabel className="text-xs text-(--text-tertiary) px-2 py-1">
                  Imperial Forces
                </RadixSelectLabel>
                <RadixSelectItem value="SOB">Sisters of Battle</RadixSelectItem>
                <RadixSelectItem value="AM">Astra Militarum</RadixSelectItem>
                <RadixSelectItem value="GK">Grey Knights</RadixSelectItem>
                <RadixSelectItem value="CUSTODES">
                  Adeptus Custodes
                </RadixSelectItem>
              </RadixSelectGroup>
            </RadixSelectContent>
          </RadixSelect>
          <p className="mt-1 text-xs text-secondary-wh40k">
            Choose your preferred theme for the dashboard
          </p>
        </div>
      </div>
    </div>
  )
}
