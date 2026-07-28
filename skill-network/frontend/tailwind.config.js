/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Semantic palette mapped to CSS custom properties (see src/index.css).
    // Both themes swap automatically via [data-theme="dark"]. No indigo/gray.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',
      bg: 'var(--bg)',
      surface: 'var(--surface)',
      raised: 'var(--surface-raised)',
      ink: 'var(--ink)',
      muted: 'var(--muted)',
      line: 'var(--line)',
      'line-strong': 'var(--line-strong)',
      accent: 'var(--accent)',
      'accent-strong': 'var(--accent-strong)',
      'accent-ink': 'var(--accent-ink)',
      success: 'var(--success)',
      danger: 'var(--danger)',
      warning: 'var(--warning)',
      wire: 'var(--wire-bg)',
      'wire-ink': 'var(--wire-ink)',
      'wire-dim': 'var(--wire-dim)',
    },
    fontFamily: {
      display: ['"Instrument Serif"', 'Georgia', 'serif'],
      sans: ['Archivo', 'system-ui', 'sans-serif'],
      mono: ['"Martian Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },
    // Square by default. 0–2px everywhere; kill rounded-full pills.
    borderRadius: {
      none: '0',
      DEFAULT: '1px',
      sm: '1px',
      md: '2px',
      lg: '2px',
      xl: '2px',
      '2xl': '2px',
      '3xl': '2px',
      full: '2px',
    },
    extend: {
      maxWidth: {
        content: '1180px',
      },
      transitionTimingFunction: {
        'out-snap': 'cubic-bezier(.2,.6,.25,1)',
      },
      boxShadow: {
        // No shadows anywhere in the app.
        none: 'none',
      },
    },
  },
  plugins: [],
}
