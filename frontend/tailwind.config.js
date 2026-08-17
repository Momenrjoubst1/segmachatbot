/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                primary: "var(--text-primary)",
                secondary: "var(--text-secondary)",
            },
            fontFamily: {
                sans: ['var(--font-noto)', 'Tajawal', 'Inter', 'sans-serif'],
                signika: ['var(--font-signika)', 'sans-serif'],
                'dm-sans': ['var(--font-dm-sans)', 'sans-serif'],
            },
            animation: {
                shimmer: 'shimmer 2s infinite',
                fadeIn: 'fadeIn 0.15s ease-out forwards',
                'fade-in': 'simpleFadeIn 0.3s ease-out forwards',
                'pulse-bar': 'pulseBar 1.5s ease-in-out infinite',
                'pulse-bar-delay': 'pulseBarShort 1.5s ease-in-out 0.2s infinite',
                'pulse-bar-delay2': 'pulseBar 1.5s ease-in-out 0.4s infinite',
                'glow': 'glow 2s ease-in-out infinite',
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                simpleFadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                pulseBar: {
                    '0%, 100%': {
                        height: '24px',
                        opacity: '0.6'
                    },
                    '50%': {
                        height: '12px',
                        opacity: '0.2'
                    }
                },
                pulseBarShort: {
                    '0%, 100%': {
                        height: '16px',
                        opacity: '0.6'
                    },
                    '50%': {
                        height: '8px',
                        opacity: '0.2'
                    }
                },
                glow: {
                    '0%, 100%': {
                        opacity: '0.5',
                        transform: 'scale(1)'
                    },
                    '50%': {
                        opacity: '0.8',
                        transform: 'scale(1.1)'
                    }
                }
            },
        },
    },
    plugins: [],
}
