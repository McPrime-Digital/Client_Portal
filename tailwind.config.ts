import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        faint: 'hsl(var(--text-faint) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        status: {
          blue: 'hsl(var(--status-blue) / <alpha-value>)',
          amber: 'hsl(var(--status-amber) / <alpha-value>)',
          violet: 'hsl(var(--status-violet) / <alpha-value>)',
          green: 'hsl(var(--status-green) / <alpha-value>)',
          gray: 'hsl(var(--status-gray) / <alpha-value>)',
        },
        // Legacy aliases now resolve to semantic tokens (theme-aware)
        'mcprime-primary': 'hsl(var(--primary) / <alpha-value>)',
        'mcprime-primary-hover': 'hsl(var(--primary) / <alpha-value>)',
        'mcprime-bg': 'hsl(var(--background) / <alpha-value>)',
        'mcprime-surface': 'hsl(var(--card) / <alpha-value>)',
        'mcprime-border': 'hsl(var(--border) / <alpha-value>)',
        'brand-bg': 'hsl(var(--background) / <alpha-value>)',
        'brand-surface': 'hsl(var(--card) / <alpha-value>)',
        'brand-border': 'hsl(var(--border) / <alpha-value>)',
        'brand-text': 'hsl(var(--foreground) / <alpha-value>)',
        'brand-muted': 'hsl(var(--muted-foreground) / <alpha-value>)',
        'brand-gold': 'hsl(var(--primary) / <alpha-value>)',
        'brand-gold-hover': 'hsl(var(--primary) / <alpha-value>)',
        'brand-error': 'hsl(var(--destructive) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
