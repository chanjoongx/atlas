/**
 * Tailwind is wired to the design tokens rather than to a palette of its own,
 * so `bg-surface` resolves to whichever theme is active and no component ever
 * hard-codes a colour. See src/styles/tokens.css.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        'canvas-deep': 'var(--bg-canvas-deep)',
        surface: 'var(--bg-surface)',
        'surface-raised': 'var(--bg-surface-raised)',
        'surface-hover': 'var(--bg-surface-hover)',
        inset: 'var(--bg-inset)',
        overlay: 'var(--bg-overlay)',
        scrim: 'var(--bg-scrim)',

        subtle: 'var(--border-subtle)',
        line: 'var(--border-default)',
        'line-strong': 'var(--border-strong)',

        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
        placeholder: 'var(--text-placeholder)',
        inverse: 'var(--text-inverse)',

        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-subtle': 'var(--accent-subtle)',
        'accent-contrast': 'var(--accent-contrast)',

        entry: 'var(--signal-entry)',
        core: 'var(--signal-core)',
        hotspot: 'var(--signal-hotspot)',
        danger: 'var(--signal-danger)',
        'danger-bg': 'var(--signal-danger-bg)',
        success: 'var(--signal-success)',
        warning: 'var(--signal-warning)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        '2xs': ['var(--text-2xs)', { lineHeight: '1.45' }],
        xs: ['var(--text-xs)', { lineHeight: '1.5' }],
        sm: ['var(--text-sm)', { lineHeight: '1.55' }],
        base: ['var(--text-base)', { lineHeight: '1.55' }],
        lg: ['var(--text-lg)', { lineHeight: '1.45' }],
        xl: ['var(--text-xl)', { lineHeight: '1.3' }],
        '2xl': ['var(--text-2xl)', { lineHeight: '1.2' }],
        '3xl': ['var(--text-3xl)', { lineHeight: '1.1' }],
        '4xl': ['var(--text-4xl)', { lineHeight: '1.05' }],
      },
      letterSpacing: {
        tight: 'var(--tracking-tight)',
        snug: 'var(--tracking-snug)',
        wide: 'var(--tracking-wide)',
        caps: 'var(--tracking-caps)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        inset: 'var(--shadow-inset)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        sweep: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        rise: {
          '0%': { transform: 'scaleY(0.28)', opacity: '0.35' },
          '55%': { transform: 'scaleY(1)', opacity: '1' },
          '100%': { transform: 'scaleY(0.28)', opacity: '0.35' },
        },
      },
      animation: {
        'fade-up': 'fade-up var(--dur-base) var(--ease-out) both',
        'fade-in': 'fade-in var(--dur-base) var(--ease-out) both',
        sweep: 'sweep 1.8s var(--ease-in-out) infinite',
        rise: 'rise 1.9s var(--ease-in-out) infinite',
      },
    },
  },
  plugins: [],
};
