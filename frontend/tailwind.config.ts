import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f6f5f0',
        foreground: '#171717',
        card: '#ffffff',
        border: '#d9d6cb',
        primary: '#0b4f6c',
        secondary: '#dce8ec',
        muted: '#ede9de',
        accent: '#f27f0c',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
