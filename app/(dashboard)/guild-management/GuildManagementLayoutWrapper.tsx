import { requireAuth } from '@/app/lib/auth'
import GuildManagementLayoutClient from './GuildManagementLayoutClient'

export default async function GuildManagementLayoutWrapper({
  children
}: {
  children: React.ReactNode
}) {
  await requireAuth()

  return <GuildManagementLayoutClient>{children}</GuildManagementLayoutClient>
}
