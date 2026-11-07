// Сквозные тесты: сайт открывается в Chromium с разными языками браузера и ширинами экрана,
// внутри страницы прогоняется общий набор проверок tests/suite.js.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SUITE = path.join(__dirname, '..', 'suite.js');
const REAL_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Ошибки JS и предупреждения о пропавших иконках считаем поломкой
function watchConsole(page) {
    const problems = [];
    page.on('pageerror', e => problems.push('Ошибка JS: ' + e.message));
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error' && !/three\.js|WebGL|GPU|favicon/i.test(t)) problems.push('console.error: ' + t);
        if (/Иконка не найдена/.test(t)) problems.push(t);
    });
    return problems;
}

async function openSite(page, url) {
    await page.goto(url || '/');
    await page.waitForFunction(() => typeof setLanguage === 'function' && document.querySelectorAll('svg.lucide').length > 0);
    await page.waitForTimeout(3200); // защита от спама в форме не принимает заявки в первые 3 секунды
}

test.describe('HTML-файл', () => {
    test('в исходном HTML запрещён автоперевод браузера', async () => {
        const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
        expect(html).toMatch(/<html[^>]*\btranslate="no"/);
        expect(html).toMatch(/<html[^>]*class="[^"]*\bnotranslate\b/);
        expect(html).toContain('<meta name="google" content="notranslate">');
    });
});

for (const width of [320, 375, 1280]) {
    test(`набор проверок проходит, ширина ${width}px`, async ({ browser }) => {
        const context = await browser.newContext({ locale: 'ru-RU', viewport: { width, height: 800 } });
        const page = await context.newPage();
        const problems = watchConsole(page);
        await openSite(page, '/');
        await page.addScriptTag({ path: SUITE });
        const result = await page.evaluate(() => window.runSiteTests());
        const failures = result.results.filter(r => !r.ok).map(r => '✗ ' + r.name + '\n    ' + r.details.join('\n    '));
        expect(failures, failures.join('\n')).toEqual([]);
        expect(problems, problems.join('\n')).toEqual([]);
        await context.close();
    });
}

const LOCALES = [
    { locale: 'he-IL', lang: 'he', dir: 'rtl' },
    { locale: 'ar-AE', lang: 'ar', dir: 'rtl' },
    { locale: 'en-US', lang: 'en', dir: 'ltr' },
    { locale: 'de-DE', lang: 'en', dir: 'ltr' },
    { locale: 'ru-RU', lang: 'ru', dir: 'ltr' },
    { locale: 'uk-UA', lang: 'ru', dir: 'ltr' }
];
for (const c of LOCALES) {
    test(`первый визит с языком браузера ${c.locale} → ${c.lang}`, async ({ browser }) => {
        // Обычный телефонный Chrome: «HeadlessChrome» сайт справедливо считает роботом и отдаёт русскую версию
        const context = await browser.newContext({ locale: c.locale, userAgent: REAL_UA, viewport: { width: 375, height: 800 } });
        const page = await context.newPage();
        const problems = watchConsole(page);
        await openSite(page, '/');
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(c.lang);
        expect(await page.evaluate(() => document.documentElement.dir || 'ltr')).toBe(c.dir);
        expect(await page.getAttribute('html', 'translate')).toBe('no');
        expect(problems, problems.join('\n')).toEqual([]);
        await context.close();
    });
}

test('без WebGL страница работает: нет ошибок, языки и квиз переключаются', async () => {
    const { chromium } = require('@playwright/test');
    const b = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const page = await b.newPage({ locale: 'ru-RU' });
    const problems = watchConsole(page);
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => typeof setLanguage === 'function');
    await page.waitForTimeout(2500);
    await page.evaluate(() => { setLanguage('HE'); setLanguage('RU'); });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
    expect(await page.locator('#sq-root button').count()).toBeGreaterThan(5);
    expect(problems, problems.join('\n')).toEqual([]);
    await b.close();
});

test('поисковый робот получает русскую версию', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    const page = await context.newPage();
    await openSite(page, '/');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
    await context.close();
});

test('выбранный язык сохраняется и ?lang= важнее языка браузера', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'he-IL', userAgent: REAL_UA });
    const page = await context.newPage();
    await openSite(page, '/?lang=ar');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ar');
    await page.evaluate(() => setLanguage('RU'));
    await openSite(page, '/');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
    await context.close();
});

test('переключение языка мышью и обратно на RU восстанавливает текст первого экрана', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await openSite(page, '/');
    const h1 = await page.textContent('h1');
    for (const L of ['EN', 'HE', 'AR', 'RU']) await page.click('#lang-' + L);
    expect(await page.textContent('h1')).toBe(h1);
    await context.close();
});
