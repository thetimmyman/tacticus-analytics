export interface GuildTheme {
  name: string
  primary: string
  secondary: string
  accent: string
  background: {
    from: string
    via: string
    to: string
  }
  cardBg: string
  cardBorder: string
  text: {
    primary: string
    secondary: string
    accent: string
  }
  heraldry?: string
  motto?: string
  pattern?: string
  palette?: {
    brass?: string
    smoke?: string
    blood?: string
    fxPsychic?: string
    fxNurgle?: string
    fxNecron?: string
    fxEldar?: string
  }
  motifs?: string[]
  renderStyle?: string
  camera?: string
  post?: {
    vignette?: number
    grain?: number
    gutterPx?: number
    cornerRadius?: number
    gradeBias?: 'warm' | 'cool' | 'neutral'
  }
  overlays?: {
    grimeUrl?: string
    chevronUrl?: string
    logoUrl?: string
  }
  semanticOverrides?: {
    warning?: string
    success?: string
    danger?: string
    info?: string
    textPrimary?: string
    textSecondary?: string
    accent?: string
  }
}
