/** Runs before hydration to prevent theme flash; inline with the CSP nonce. */

interface ThemeScriptProps {
  nonce?: string
}

export function ThemeScript({ nonce }: ThemeScriptProps) {
  const themeScript = `
    (function() {
      // Get saved theme from localStorage or use default
      let savedTheme = null;
      try {
        savedTheme = localStorage.getItem('theme-override');
      } catch (e) {}
      
      // Default to dark theme for consistency
      const theme = savedTheme || 'dark';
      
      // Define theme configurations
      const themes = {
        'dark': {
          '--primary': '#60a5fa',
          '--secondary': '#3b82f6',
          '--accent': '#93c5fd',
          '--bg-from': '#0f172a',
          '--bg-via': '#1e293b',
          '--bg-to': '#0f172a',
          '--card-bg': 'rgba(30, 41, 59, 0.8)',
          '--card-border': 'rgba(71, 85, 105, 0.5)',
          '--text-primary': '#f3f4f6',
          '--text-secondary': '#d1d5db',
          '--text-accent': '#60a5fa',
          '--bg-primary': '#0f172a',
          '--primary-wh40k': '#60a5fa',
          '--secondary-wh40k': '#3b82f6',
          '--accent-wh40k': '#93c5fd',
          '--card': 'rgba(30, 41, 59, 0.8)',
          '--light': 'rgba(71, 85, 105, 0.5)'
        },
        'HORUS_HERESY': {
          '--primary': '#DC143C',
          '--secondary': '#FFD700',
          '--accent': '#FF6347',
          '--bg-from': '#1a0000',
          '--bg-via': '#330000',
          '--bg-to': '#1a0000',
          '--card-bg': 'rgba(139, 0, 0, 0.3)',
          '--card-border': 'rgba(220, 20, 60, 0.5)',
          '--text-primary': '#FFD700',
          '--text-secondary': '#FFA500',
          '--text-accent': '#FF6347',
          '--bg-primary': '#1a0000',
          '--primary-wh40k': '#DC143C',
          '--secondary-wh40k': '#FFD700',
          '--accent-wh40k': '#FF6347',
          '--card': 'rgba(139, 0, 0, 0.3)',
          '--light': 'rgba(220, 20, 60, 0.5)'
        }
      };
      
      // Apply theme CSS variables immediately
      const root = document.documentElement;
      const themeVars = themes[theme] || themes['dark'];
      
      Object.entries(themeVars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });
      
      // Set data-theme attribute
      root.setAttribute('data-theme', theme);
      
      // Add class to prevent transitions during initial load
      root.classList.add('theme-loading');
      
      // Remove loading class after a short delay
      setTimeout(() => {
        root.classList.remove('theme-loading');
      }, 0);
    })();
  `.trim()

  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: themeScript }}
      suppressHydrationWarning
    />
  )
}
