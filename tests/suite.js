/*
 * Регрессионные тесты сайта UroHub: переключение языков, защита от автоперевода браузера, квиз, окна, формы.
 * Скрипт выполняется внутри страницы (index.html) и пользуется её глобальными функциями и переменными.
 * Запуск:
 *   - в браузере: открыть /tests/run.html (страница сама загрузит сайт и покажет результат);
 *   - автоматически: tests/e2e/site.spec.js (Playwright, GitHub Actions при каждом пуше).
 * Результат: await window.runSiteTests() → { passed, failed, results: [{ name, ok, details }] }
 */
(function () {
    'use strict';

    const LANGS = ['RU', 'EN', 'HE', 'AR'];
    const CYRILLIC = /[А-Яа-яЁё]/;
    const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Все текстовые узлы страницы (кроме скриптов и стилей), включая скрытые: меню, окна, ловушку для ботов
    function textNodes(root) {
        const out = [];
        const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => (n.parentElement && n.parentElement.closest('script, style, noscript')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        while (walker.nextNode()) out.push(walker.currentNode);
        return out;
    }

    // Снимок всего, что видит человек: тексты, подписи для экранного диктора, подсказки, заголовок вкладки
    function snapshot() {
        const texts = textNodes().map(n => n.nodeValue.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const attrs = [];
        document.querySelectorAll('*').forEach(el => {
            ATTRS.forEach(a => { if (el.hasAttribute(a)) attrs.push(a + '=' + el.getAttribute(a)); });
        });
        const metas = [...document.querySelectorAll('meta[name="description"], meta[property^="og:"], link[rel="canonical"]')]
            .map(m => (m.getAttribute('content') || m.getAttribute('href') || ''));
        return { texts, attrs, metas, title: document.title, lang: document.documentElement.lang, dir: document.documentElement.dir || 'ltr' };
    }

    function diffList(a, b, limit) {
        const out = [];
        const max = Math.max(a.length, b.length);
        for (let i = 0; i < max && out.length < (limit || 5); i++) {
            if (a[i] !== b[i]) out.push('#' + i + ': «' + String(a[i]).slice(0, 80) + '» → «' + String(b[i]).slice(0, 80) + '»');
        }
        if (a.length !== b.length) out.push('кол-во: ' + a.length + ' → ' + b.length);
        return out;
    }

    // Кириллица в тексте и подписях внутри root (для EN/HE/AR её быть не должно)
    function findCyrillic(root) {
        const hits = [];
        textNodes(root).forEach(n => {
            const v = n.nodeValue.trim();
            if (v && CYRILLIC.test(v)) hits.push('текст «' + v.slice(0, 70) + '» в <' + n.parentElement.tagName.toLowerCase() + (n.parentElement.id ? '#' + n.parentElement.id : '') + '>');
        });
        (root || document.body).querySelectorAll('*').forEach(el => {
            ATTRS.forEach(a => {
                const v = el.getAttribute(a);
                if (v && CYRILLIC.test(v)) hits.push(a + '="' + v.slice(0, 70) + '" у <' + el.tagName.toLowerCase() + '>');
            });
            if (el.tagName === 'OPTION' && CYRILLIC.test(el.textContent)) hits.push('пункт списка «' + el.textContent.trim().slice(0, 70) + '»');
        });
        return hits;
    }

    // Одинаковый набор ключей у всех языков (чтобы ни один перевод не потерялся)
    function keyPaths(obj, prefix) {
        if (obj === null || typeof obj !== 'object') return [prefix];
        return Object.keys(obj).flatMap(k => keyPaths(obj[k], prefix ? prefix + '.' + k : k));
    }

    async function runSiteTests() {
        const results = [];
        const test = async (name, fn) => {
            try {
                const problems = (await fn()) || [];
                results.push({ name, ok: problems.length === 0, details: problems.slice(0, 12) });
            } catch (e) {
                results.push({ name, ok: false, details: ['исключение: ' + (e && e.stack || e)] });
            }
        };

        const startLang = currentLang;
        const savedStorage = {};
        ['urohub-lang', 'urohub-leads'].forEach(k => { try { savedStorage[k] = localStorage.getItem(k); } catch (e) {} });
        const savedQuiz = JSON.parse(JSON.stringify(sqState));
        const restoreQuiz = () => { Object.assign(sqState, JSON.parse(JSON.stringify(savedQuiz))); renderSymptomQuiz(); };

        // ---------- 1. Защита от автоперевода браузера (причина «мусорного» текста после смены языка) ----------
        await test('Автоперевод браузера запрещён (translate="no", notranslate, meta google)', () => {
            const p = [];
            const html = document.documentElement;
            if (html.getAttribute('translate') !== 'no') p.push('у <html> нет translate="no"');
            if (!html.classList.contains('notranslate')) p.push('у <html> нет класса notranslate');
            const meta = document.querySelector('meta[name="google"]');
            if (!meta || meta.getAttribute('content') !== 'notranslate') p.push('нет <meta name="google" content="notranslate">');
            // Ни один блок страницы не должен разрешать перевод обратно
            document.querySelectorAll('[translate="yes"]').forEach(el => p.push('translate="yes" у <' + el.tagName.toLowerCase() + '>'));
            return p;
        });

        await test('После смены языка класс notranslate и translate="no" сохраняются', async () => {
            const p = [];
            for (const L of LANGS) {
                setLanguage(L);
                const html = document.documentElement;
                if (html.getAttribute('translate') !== 'no' || !html.classList.contains('notranslate')) p.push(L + ': защита от автоперевода пропала');
            }
            setLanguage('RU');
            return p;
        });

        // ---------- 2. Словари: у каждого языка все переводы на месте ----------
        await test('Словари I18N: у каждой фразы есть EN, HE и AR', () => {
            const p = [];
            const dicts = { I18N_HTML, I18N_TEXT, I18N_ATTR, I18N_CALLOUTS };
            Object.entries(dicts).forEach(([dname, d]) => {
                Object.entries(d).forEach(([ru, tr]) => {
                    ['EN', 'HE', 'AR'].forEach(L => {
                        if (!tr || typeof tr[L] !== 'string' || !tr[L].trim()) p.push(dname + ': нет ' + L + ' для «' + ru.slice(0, 50) + '»');
                        else if (CYRILLIC.test(tr[L].replace(/<[^>]*>/g, ''))) p.push(dname + ': кириллица в ' + L + ' для «' + ru.slice(0, 50) + '»');
                    });
                });
            });
            return p;
        });

        await test('Тексты квиза, 3D-подсказок и триажа: одинаковые ключи на всех языках', () => {
            const p = [];
            const tables = { SQ_TEXT, HUD_TEXT, triageDataByLang };
            Object.entries(tables).forEach(([tname, t]) => {
                const base = keyPaths(t.RU, '').sort().join('|');
                ['EN', 'HE', 'AR'].forEach(L => {
                    if (!t[L]) { p.push(tname + ': нет языка ' + L); return; }
                    const keys = keyPaths(t[L], '').sort();
                    const missing = keyPaths(t.RU, '').filter(k => !keys.includes(k));
                    if (keys.join('|') !== base) p.push(tname + '.' + L + ': расходятся ключи, нет: ' + missing.slice(0, 5).join(', '));
                });
            });
            return p;
        });

        // ---------- 3. Круговое переключение: русский текст восстанавливается в точности ----------
        await test('Круг RU → EN → HE → AR → RU возвращает русский текст в точности', async () => {
            setLanguage('RU');
            const before = snapshot();
            const orders = [['EN', 'HE', 'AR'], ['AR', 'EN', 'HE'], ['HE', 'HE', 'EN', 'AR', 'AR']];
            const p = [];
            for (const order of orders) {
                order.forEach(L => setLanguage(L));
                setLanguage('RU');
                const after = snapshot();
                diffList(before.texts, after.texts).forEach(d => p.push('[' + order.join('→') + '] текст ' + d));
                diffList(before.attrs, after.attrs).forEach(d => p.push('[' + order.join('→') + '] атрибут ' + d));
                diffList(before.metas, after.metas).forEach(d => p.push('[' + order.join('→') + '] мета ' + d));
                if (before.title !== after.title) p.push('заголовок вкладки: ' + after.title);
                if (after.lang !== 'ru' || after.dir !== 'ltr') p.push('lang/dir после возврата: ' + after.lang + '/' + after.dir);
            }
            return p;
        });

        await test('Перевод на каждый язык одинаков при повторном выборе (без накопления изменений)', async () => {
            const p = [];
            for (const L of ['EN', 'HE', 'AR']) {
                setLanguage(L);
                const first = snapshot();
                setLanguage('RU'); setLanguage(L === 'EN' ? 'AR' : 'EN'); setLanguage(L);
                const second = snapshot();
                diffList(first.texts, second.texts, 3).forEach(d => p.push(L + ' текст ' + d));
                diffList(first.attrs, second.attrs, 3).forEach(d => p.push(L + ' атрибут ' + d));
            }
            setLanguage('RU');
            return p;
        });

        // ---------- 4. На EN/HE/AR не остаётся русского ----------
        await test('EN/HE/AR: на странице нет русского текста', () => {
            const p = [];
            ['EN', 'HE', 'AR'].forEach(L => {
                setLanguage(L);
                findCyrillic(document.body).forEach(h => p.push(L + ': ' + h));
            });
            setLanguage('RU');
            return p;
        });

        await test('lang, dir, заголовок вкладки, canonical и список языков соответствуют языку', () => {
            const p = [];
            const select = document.getElementById('lang-select-mobile');
            LANGS.forEach(L => {
                setLanguage(L);
                const html = document.documentElement;
                if (html.lang !== L.toLowerCase()) p.push(L + ': lang=' + html.lang);
                const wantDir = (L === 'HE' || L === 'AR') ? 'rtl' : 'ltr';
                if ((html.dir || 'ltr') !== wantDir) p.push(L + ': dir=' + html.dir);
                if (document.title !== PAGE_TITLES[L]) p.push(L + ': заголовок вкладки «' + document.title + '»');
                const canon = document.querySelector('link[rel="canonical"]');
                const want = 'https://urologyhubtbilisi.vercel.app/' + (L === 'RU' ? '' : '?lang=' + L.toLowerCase());
                if (!canon || canon.href !== want) p.push(L + ': canonical ' + (canon && canon.href));
                if (select && select.value !== L) p.push(L + ': список языков в шапке показывает ' + select.value);
                document.querySelectorAll('.lang-btn').forEach(b => {
                    const code = b.id ? b.id.replace('lang-', '') : b.dataset.lang;
                    const active = b.className.includes('bg-slate-900');
                    if ((code === L) !== active) p.push(L + ': кнопка ' + code + (active ? ' подсвечена лишняя' : ' не подсвечена'));
                });
                const ru = /[?&]lang=/.test(location.search);
                if ((L === 'RU') === ru) p.push(L + ': адрес ' + location.search);
            });
            setLanguage('RU');
            return p;
        });

        // ---------- 5. Динамические блоки на всех языках ----------
        await test('Квиз: все шаги и итоги без русского текста на EN/HE/AR', async () => {
            const p = [];
            const root = document.getElementById('sq-root');
            const scenarios = [
                { problems: SQ_PROBLEMS.map(x => x.id), goal: 'surg' },       // всё сразу + тревожные симптомы
                { problems: ['ed'], goal: 'nonsurg' },                         // программа «лечение без операции»
                { problems: ['checkup'], goal: 'opinion' },                    // программа «обследование»
                { problems: ['stones'], goal: 'surg' }                         // программа «операция»
            ];
            for (const L of ['EN', 'HE', 'AR']) {
                setLanguage(L);
                for (const sc of scenarios) {
                    const follow = {};
                    sc.problems.forEach(id => (SQ_PROBLEMS.find(x => x.id === id).follow || []).forEach(f => { follow[f] = SQ_FOLLOW_OPTIONS[f][0]; }));
                    Object.assign(sqState, { problems: sc.problems, duration: SQ_DURATIONS[0], follow, docs: [SQ_DOCS[0]], goal: sc.goal });
                    for (const step of [0, 1, 2, 3, 4, 5]) {
                        sqState.step = step;
                        const statuses = step === 5 ? ['idle', 'invalid', 'sending', 'error', 'sent'] : ['idle'];
                        for (const st of statuses) {
                            sqState.callback.status = st;
                            sqState.callback.phone = '+972501234567';
                            renderSymptomQuiz();
                            findCyrillic(root).forEach(h => p.push(L + ' / ' + sc.problems.join('+') + ' / шаг ' + step + (step === 5 ? ' / ' + st : '') + ': ' + h));
                            if (typeof sqMessage === 'function' && step === 5 && st === 'idle') {
                                const msg = sqMessage();
                                if (CYRILLIC.test(msg)) p.push(L + ': сообщение координатору на русском: «' + msg.slice(0, 60) + '»');
                            }
                        }
                    }
                }
            }
            restoreQuiz();
            setLanguage('RU');
            return p;
        });

        await test('Триаж на первом экране: все варианты без русского текста на EN/HE/AR', () => {
            const p = [];
            const keys = Object.keys(triageDataByLang.RU);
            const prevKey = currentTriageKey;
            ['EN', 'HE', 'AR'].forEach(L => {
                setLanguage(L);
                keys.forEach(k => {
                    selectTriage(k);
                    findCyrillic(document.body).forEach(h => p.push(L + ' / ' + k + ': ' + h));
                });
            });
            setLanguage('RU');
            selectTriage(prevKey);
            return p;
        });

        await test('Окно 3D: все вкладки без русского текста на EN/HE/AR, Esc закрывает', async () => {
            const p = [];
            const modal = document.getElementById('modal-3d-cinema');
            for (const L of ['EN', 'HE', 'AR']) {
                setLanguage(L);
                for (const k of ['checkup', 'ed', 'bph', 'rirs', 'onco']) {
                    open3DModal(k);
                    findCyrillic(modal).forEach(h => p.push(L + ' / ' + k + ': ' + h));
                }
                // Смена языка при открытом окне обновляет и окно
                setLanguage(L === 'EN' ? 'HE' : 'EN');
                setLanguage(L);
                findCyrillic(modal).forEach(h => p.push(L + ' / после смены языка: ' + h));
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                if (!modal.classList.contains('hidden')) { p.push(L + ': Esc не закрыл окно 3D'); close3DModal(); }
            }
            setLanguage('RU');
            if (modal.getAttribute('role') !== 'dialog' || modal.getAttribute('aria-modal') !== 'true') p.push('у окна 3D нет role="dialog" / aria-modal');
            return p;
        });

        await test('Форма заявки: проверка телефона и сообщение об успехе на всех языках', async () => {
            const p = [];
            const $ = id => document.getElementById(id);
            const form = $('consultation-form');
            const modal = $('success-modal');
            const origWarn = console.warn;
            console.warn = () => {};
            try {
                for (const L of LANGS) {
                    setLanguage(L);
                    try { localStorage.removeItem('urohub-leads'); } catch (e) {}
                    $('patient-name').value = 'Test'; $('patient-country').value = 'City';
                    document.querySelector('input[name="messenger"][value="WhatsApp"]').click();
                    $('patient-phone').value = '123';
                    await handleLeadSubmit(new Event('submit', { cancelable: true }));
                    if (!modal.classList.contains('hidden')) { p.push(L + ': короткий номер «123» принят'); closeSuccessModal(); }
                    const msg = $('patient-phone').validationMessage;
                    if (!msg) p.push(L + ': нет текста ошибки для неверного номера');
                    else if (L !== 'RU' && CYRILLIC.test(msg)) p.push(L + ': ошибка номера на русском');
                    $('patient-phone').setCustomValidity('');

                    $('patient-phone').value = '+972 50 123 4567';
                    await handleLeadSubmit(new Event('submit', { cancelable: true }));
                    if (modal.classList.contains('hidden')) p.push(L + ': правильная заявка не дошла до окна «Спасибо»');
                    else {
                        if (L !== 'RU') findCyrillic(modal).forEach(h => p.push(L + ' / окно «Спасибо»: ' + h));
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                        if (!modal.classList.contains('hidden')) { p.push(L + ': Esc не закрыл окно «Спасибо»'); closeSuccessModal(); }
                    }
                    if ($('patient-name').value !== '') p.push(L + ': форма не очистилась после отправки');
                }
            } finally {
                console.warn = origWarn;
                form.reset();
                setLanguage('RU');
            }
            return p;
        });

        // ---------- 6. Функции: язык браузера и проверка телефона ----------
        await test('Язык по настройкам браузера: he → HE, ar → AR, СНГ → RU, прочие → EN, роботы → RU', () => {
            const p = [];
            const cases = [
                [['he-IL'], 'Mozilla/5.0 (iPhone)', 'HE'],
                [['iw'], 'Mozilla/5.0', 'HE'],
                [['ar-AE', 'en'], 'Mozilla/5.0', 'AR'],
                [['ru-RU'], 'Mozilla/5.0', 'RU'],
                [['uk-UA'], 'Mozilla/5.0', 'RU'],
                [['kk-KZ'], 'Mozilla/5.0', 'RU'],
                [['en-US'], 'Mozilla/5.0', 'EN'],
                [['de-DE', 'fr'], 'Mozilla/5.0', 'EN'],
                [['de-DE', 'ru'], 'Mozilla/5.0', 'RU'],
                [['en-US'], 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'RU'],
                [['en-US'], 'Mozilla/5.0 (compatible; YandexBot/3.0)', 'RU']
            ];
            const nav = window.navigator;
            try {
                cases.forEach(([langs, ua, want]) => {
                    Object.defineProperty(nav, 'languages', { configurable: true, get: () => langs });
                    Object.defineProperty(nav, 'language', { configurable: true, get: () => langs[0] });
                    Object.defineProperty(nav, 'userAgent', { configurable: true, get: () => ua });
                    const got = detectBrowserLanguage();
                    if (got !== want) p.push(langs.join(',') + ' / ' + ua.slice(0, 30) + ': ожидали ' + want + ', получили ' + got);
                });
            } finally {
                delete nav.languages; delete nav.language; delete nav.userAgent;
            }
            return p;
        });

        await test('Проверка телефона и ника Telegram', () => {
            const p = [];
            [['+972 50 123 4567', true], ['+7 (999) 123-45-67', true], ['971501234567', true], ['123', false], ['abc', false], ['+1 234', false], ['1234567890123456', false]]
                .forEach(([v, want]) => { if (isValidPhone(v) !== want) p.push('телефон «' + v + '»: ожидали ' + want); });
            [['@ivan_petrov', true], ['john_smith', true], ['@ab', false], ['@1abcde', false], ['@ivan petrov', false]]
                .forEach(([v, want]) => { if (isValidTelegram(v) !== want) p.push('ник «' + v + '»: ожидали ' + want); });
            return p;
        });

        await test('Подпись разработчика «BoldFox Lab. LLC» в подвале на всех языках', () => {
            const p = [];
            const want = { RU: 'Разработка сайта — BoldFox Lab. LLC', EN: 'Website developed by BoldFox Lab. LLC', HE: 'פיתוח האתר: BoldFox Lab. LLC', AR: 'تطوير الموقع: BoldFox Lab. LLC' };
            LANGS.forEach(L => {
                setLanguage(L);
                const el = document.getElementById('site-credit');
                if (!el || !el.closest('footer')) { p.push('нет блока #site-credit в подвале'); return; }
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                if (text !== want[L]) p.push(L + ': «' + text + '» вместо «' + want[L] + '»');
                const name = el.querySelector('bdi');
                if (!name || name.getAttribute('dir') !== 'ltr' || name.textContent !== 'BoldFox Lab. LLC') p.push(L + ': название компании не в <bdi dir="ltr">');
            });
            setLanguage('RU');
            return p;
        });

        // ---------- 7. Иконки и вёрстка ----------
        await test('Все иконки отрисованы (нет пустых <i data-lucide>)', () => {
            lucide.createIcons();
            return [...document.querySelectorAll('i[data-lucide]')].map(i => 'не найдена иконка «' + i.getAttribute('data-lucide') + '»');
        });

        await test('Нет горизонтальной прокрутки ни на одном языке', () => {
            const p = [];
            LANGS.forEach(L => {
                setLanguage(L);
                const de = document.documentElement;
                if (de.scrollWidth > de.clientWidth + 1) p.push(L + ': ширина страницы ' + de.scrollWidth + ' при экране ' + de.clientWidth);
            });
            setLanguage('RU');
            return p;
        });

        // ---------- Восстановление состояния ----------
        setLanguage(startLang);
        Object.entries(savedStorage).forEach(([k, v]) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} });

        const failed = results.filter(r => !r.ok).length;
        return { passed: results.length - failed, failed, results };
    }

    window.runSiteTests = runSiteTests;
})();
