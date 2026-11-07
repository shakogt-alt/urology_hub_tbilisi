// Сквозные тесты сайта в настоящем браузере Chromium (запускаются на GitHub Actions при каждом пуше).
// Локально: npm install --no-save @playwright/test@1.49.1 && npx playwright install chromium && npx playwright test -c tests/playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 120000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['github']] : 'list',
    use: {
        baseURL: 'http://127.0.0.1:5173',
        browserName: 'chromium',
        trace: 'retain-on-failure'
    },
    webServer: {
        // Простой статический сервер из корня проекта (как Vercel отдаёт сайт)
        command: 'python3 -m http.server 5173 --bind 127.0.0.1',
        cwd: '..',
        url: 'http://127.0.0.1:5173/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30000
    }
});
