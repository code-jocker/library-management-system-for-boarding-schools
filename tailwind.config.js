// tailwind.config.js
// Build-time Tailwind config. Mirrors the previous Play-CDN config so the
// compiled stylesheet keeps the exact brand look. Classes are scanned from the
// HTML shell and every JS module (utilities live inside template strings).
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        primary:   { DEFAULT: '#1E3A8A', 50: '#eef2ff', 100: '#e0e7ff', 500: '#3b5bdb', 600: '#1E3A8A', 700: '#172c66' },
        secondary: { DEFAULT: '#F59E0B', 50: '#fffbeb', 100: '#fef3c7', 500: '#F59E0B', 600: '#d97706' },
        success:   '#16A34A',
        warning:   '#EA580C',
        danger:    '#DC2626',
        surface:   '#F8FAFC',
        card:      '#FFFFFF'
      },
      fontFamily: {
        heading: ['Poppins', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif']
      },
      borderRadius: { card: '12px', input: '8px' },
      boxShadow: {
        soft: '0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.06)',
        card: '0 4px 16px rgba(15,23,42,.08)'
      },
      spacing: { '4.5': '18px' }
    }
  },
  plugins: []
};
