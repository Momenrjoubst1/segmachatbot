/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
            },
            animation: {
                shimmer: 'shimmer 2s infinite',
                fadeIn: 'fadeIn 0.15s ease-out forwards',
            },
            fontFamily: {
                sans: ['Tajawal', 'Inter', 'sans-serif'],
                serif: ['Times New Roman', 'serif'],
                mono: ['Fira Code', 'Courier New', 'monospace'],
            },
        },
    },
    plugins: [],
}
