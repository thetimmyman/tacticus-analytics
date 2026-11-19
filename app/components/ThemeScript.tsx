import { getFirstPaintThemes } from '@/app/lib/themes/first-paint'

/** Runs before hydration to prevent theme flash; inline with the CSP nonce. */

interface ThemeScriptProps {
  nonce?: string
}

// `<` is escaped so no theme value can ever close the script element.
const FIRST_PAINT_THEMES_JSON = JSON.stringify(getFirstPaintThemes()).replace(
  /</g,
  '\\u003c'
)

const themeScript = `
(function() {
  var themes = ${FIRST_PAINT_THEMES_JSON};
  var validCode = /^[A-Za-z0-9_-]+$/;

  // The app stores the choice as JSON ("light", with quotes); older values
  // may be bare. Anything that is not a plain theme code means dark.
  var code = 'dark';
  try {
    var saved = localStorage.getItem('theme-override');
    if (saved) {
      var parsed;
      try {
        parsed = JSON.parse(saved);
      } catch (e) {
        parsed = saved;
      }
      if (typeof parsed === 'string' && validCode.test(parsed)) {
        code = parsed;
      }
    }
  } catch (e) {}

  var own = Object.prototype.hasOwnProperty;
  var themeVars = own.call(themes, code) ? themes[code] : themes.dark;

  var root = document.documentElement;
  Object.keys(themeVars).forEach(function(key) {
    root.style.setProperty(key, themeVars[key]);
  });

  // The stylesheet keys its light-theme block off this attribute.
  root.setAttribute('data-theme', code);

  // Add class to prevent transitions during initial load
  root.classList.add('theme-loading');
  setTimeout(function() {
    root.classList.remove('theme-loading');
  }, 0);
})();
`.trim()

export function ThemeScript({ nonce }: ThemeScriptProps) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: themeScript }}
      suppressHydrationWarning
    />
  )
}
