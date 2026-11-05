// Сборка стилей: tailwindcss -c tailwind.config.js -i src/input.css -o styles.css --minify
// (Tailwind CLI v3.4.17; после правок классов в index.html нужно пересобрать styles.css)
module.exports = {
    content: ['./index.html'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Heebo', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
            },
            colors: {
                brand: {
                    50: '#f0fdfa',
                    100: '#ccfbf1',
                    200: '#99f6e4',
                    500: '#14b8a6',
                    600: '#0d9488',
                    700: '#0f766e',
                    800: '#115e59',
                    900: '#134e4a',
                }
            },
            boxShadow: {
                'premium': '0 20px 50px -12px rgba(15, 23, 42, 0.08)',
                'glow': '0 0 35px -5px rgba(13, 148, 136, 0.35)',
            }
        }
    }
};
