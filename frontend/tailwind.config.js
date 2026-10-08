/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                risk: {
                    safe: '#10B981',
                    warning: '#F59E0B',
                    danger: '#EF4444',
                },
                dark: {
                    bg: '#0f172a',
                    card: '#1e293b',
                    text: '#f8fafc',
                }
            },
            fontFamily: {
                heading: ['Cairo', 'sans-serif'],
                body: ['Tajawal', 'sans-serif'],
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }
        },
    },
    plugins: [],
}
