export const prependRolePings = (
  roleIds: string[],
  content: string
): string => {
  if (roleIds.length === 0) return content
  const mentions = roleIds.map((id) => `<@&${id}>`).join(' ')
  return `${mentions}\n${content}`
}

// Pings go after the text so mobile push previews lead with the event.
export const appendRolePings = (
  roleIds: string[],
  previewLine: string,
  rolePingText?: string
): string => {
  const mention = rolePingText ?? roleIds.map((id) => `<@&${id}>`).join(' ')
  if (mention.length === 0) return previewLine
  if (previewLine.length === 0) return mention
  return `${previewLine}\n${mention}`
}
