import GuildManagementLayoutWrapper from './GuildManagementLayoutWrapper'

export default function GuildManagementLayout({
  children
}: {
  children: React.ReactNode
}) {
  return <GuildManagementLayoutWrapper>{children}</GuildManagementLayoutWrapper>
}
