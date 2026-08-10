// ==UserScript==
// @name         Chasse aux Livres — copie rapide mobile
// @namespace    https://www.chasse-aux-livres.fr/
// @version      2.4.0
// @description  Copie les infos et le résumé d'un livre, avec les données de ventes BiblioScan.
// @author       Vous
// @match        https://www.chasse-aux-livres.fr/prix/*
// @match        https://chasse-aux-livres.fr/prix/*
// @downloadURL  https://raw.githubusercontent.com/zobalteamtim-source/extension-snake-tst/momox-price-checker-4693882804824414681/chasse-aux-livres-copie-mobile.user.js
// @updateURL    https://raw.githubusercontent.com/zobalteamtim-source/extension-snake-tst/momox-price-checker-4693882804824414681/chasse-aux-livres-copie-mobile.user.js
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @connect      biblioscan.ai
// @inject-into  content
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'cal-copie-rapide';
  const RETRIES = 20;
  const RETRY_DELAY = 500;
  const BIBLIO_API = 'https://biblioscan.ai';
  const BIBLIO_KEY_STORAGE = 'cal_biblioscan_api_key';
  const BIBLIO_CACHE_PREFIX = 'cal_biblioscan_cache_';
  const gmApi = typeof GM !== 'undefined' ? GM : null;

  const clean = (value) => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

  function pageLines() {
    return (document.body?.innerText || '')
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
  }

  function valueAfterLabel(labels) {
    const lines = pageLines();

    for (const label of labels) {
      const sameLine = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'i');
      const labelOnly = new RegExp(`^${label}\\s*[:：]?\\s*$`, 'i');

      for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(sameLine);
        if (match?.[1]) return clean(match[1]);
        if (labelOnly.test(lines[index]) && lines[index + 1]) return clean(lines[index + 1]);
      }
    }

    return '';
  }

  function jsonLdBooks() {
    const found = [];

    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.some((type) => /^(book|product)$/i.test(String(type || '')))) found.push(value);
      Object.values(value).forEach(visit);
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        visit(JSON.parse(script.textContent));
      } catch (_) {
        // Certaines pages contiennent un JSON-LD invalide : les autres méthodes prennent le relais.
      }
    });

    return found;
  }

  function namedValue(value) {
    if (Array.isArray(value)) return value.map(namedValue).filter(Boolean).join(', ');
    if (value && typeof value === 'object') return clean(value.name || value.value || '');
    return clean(value);
  }

  const comparable = (value) => clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  function usableSummary(value) {
    const text = clean(value);
    if (text.length < 60 || text.length > 12000) return '';
    if (/^(paru|publie|sorti)\s+le\b/i.test(comparable(text))) return '';
    if (/^(resume|description)(\s+voir tout)?$/i.test(comparable(text))) return '';
    return text;
  }

  function embeddedSummaryCandidates() {
    const found = [];
    const visit = (value, key = '', depth = 0) => {
      if (depth > 12 || value === null || value === undefined) return;
      if (typeof value === 'string') {
        if (/(resume|summary|synopsis|description|presentation)/i.test(comparable(key))) {
          const text = usableSummary(value);
          if (text) found.push({ text, score: /(resume|summary|synopsis)/i.test(comparable(key)) ? 100 : 60 });
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, key, depth + 1));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
      }
    };

    document.querySelectorAll('script[type*="json" i]').forEach((script) => {
      try { visit(JSON.parse(script.textContent)); } catch (_) { /* JSON embarqué invalide ignoré. */ }
    });
    return found.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  }

  function summaryNearHeading() {
    const labels = [...document.querySelectorAll(
      'a, button, h2, h3, h4, h5, [role="heading"], dt, strong, span'
    )].filter((element) => (
      !element.closest(`#${PANEL_ID}`) && /^(resume|description)( du livre)?$/.test(comparable(element.textContent))
    ));
    const candidates = [];
    const add = (element, score) => {
      if (!element || element.closest?.(`#${PANEL_ID}`)) return;
      const text = usableSummary(element.innerText || element.textContent);
      if (text) candidates.push({ text, score });
    };

    labels.forEach((label) => {
      const references = [
        label.getAttribute('aria-controls'),
        label.getAttribute('data-target'),
        label.getAttribute('data-bs-target'),
        label.getAttribute('href'),
      ].map((value) => {
        if (!value) return '';
        if (value.startsWith('#')) return value;
        try {
          const url = new URL(value, location.href);
          return url.origin === location.origin && url.pathname === location.pathname ? url.hash : '';
        } catch (_) {
          return '';
        }
      }).filter(Boolean);
      references.forEach((reference) => {
        try { add(document.querySelector(reference), 100); } catch (_) { /* Sélecteur invalide ignoré. */ }
      });

      let sibling = label.nextElementSibling;
      for (let index = 0; sibling && index < 4; index += 1, sibling = sibling.nextElementSibling) {
        add(sibling, 90 - index);
      }
      add(label.parentElement?.nextElementSibling, 80);
      add(label.parentElement?.parentElement?.nextElementSibling, 70);

      const section = label.closest('section, article, [role="tabpanel"]');
      if (section) {
        const paragraphs = [...section.querySelectorAll('p, li')]
          .map((element) => clean(element.innerText || element.textContent))
          .filter(Boolean)
          .join('\n');
        const text = usableSummary(paragraphs);
        if (text) candidates.push({ text, score: 50 });
      }
    });

    return candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0]?.text || '';
  }

  function readSummary(primaryBook) {
    const selectors = [
      '[itemprop="description"]',
      '[class*="book-description" i]',
      '[id*="book-description" i]',
      '[class*="resume" i]',
      '[id*="resume" i]',
      '[class*="summary" i]',
      '[id*="summary" i]',
      '[class*="synopsis" i]',
      '[id*="synopsis" i]',
      '[data-description]',
      '[data-summary]',
      '[data-resume]',
      '[data-synopsis]',
    ];
    const elements = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => !element.closest(`#${PANEL_ID}`));
    const domCandidates = elements
      .flatMap((element) => [
        element.innerText || element.textContent,
        element.getAttribute('data-description'),
        element.getAttribute('data-summary'),
        element.getAttribute('data-resume'),
        element.getAttribute('data-synopsis'),
      ])
      .map(usableSummary)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const jsonDescription = usableSummary(namedValue(primaryBook.description));
    const embedded = embeddedSummaryCandidates()[0]?.text || '';

    return clean(
      summaryNearHeading() ||
      domCandidates[0] ||
      embedded ||
      jsonDescription ||
      ''
    );
  }

  function validIsbn13(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!/^97[89]\d{10}$/.test(digits)) return '';

    const sum = digits
      .slice(0, 12)
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(digits[12]) ? digits : '';
  }

  function firstValidIsbn13(values) {
    for (const value of values) {
      const matches = String(value || '').match(/97[89](?:[\s.-]?\d){10}/g) || [];
      for (const match of matches) {
        const isbn = validIsbn13(match);
        if (isbn) return isbn;
      }
    }
    return '';
  }

  function readBookData() {
    const books = jsonLdBooks();
    const primaryBook = books.find((book) => book.name) || books[0] || {};
    const title = clean(
      document.querySelector('main h1, article h1, h1')?.textContent ||
      primaryBook.name ||
      document.querySelector('meta[property="og:title"]')?.content?.split(/\s+-\s+les Prix/i)[0] ||
      ''
    );

    const author = clean(
      valueAfterLabel(['Auteur\\(s\\)', 'Auteurs?']) ||
      namedValue(primaryBook.author)
    );

    const publisher = clean(
      valueAfterLabel(['[ÉE]diteur']) ||
      namedValue(primaryBook.publisher || primaryBook.brand)
    );

    const labelledIsbn = valueAfterLabel(['ISBN[- ]?13', 'EAN']);
    const urlCandidates = decodeURIComponent(location.pathname).match(/97[89](?:[\s.-]?\d){10}/g) || [];
    const isbn13 = firstValidIsbn13([
      labelledIsbn,
      primaryBook.isbn,
      primaryBook.gtin13,
      ...urlCandidates.reverse(),
    ]);

    const weight = clean(
      valueAfterLabel(['Poids']) ||
      namedValue(primaryBook.weight)
    );

    const summary = readSummary(primaryBook);

    return { title, author, publisher, isbn13, weight, summary };
  }

  async function writeClipboard(text) {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      document.execCommand('copy');
      area.remove();
    }
  }

  async function copyText(text, button) {
    if (!text) return;
    await writeClipboard(text);

    const oldText = button.querySelector('.cal-label').textContent;
    button.classList.add('cal-copied');
    button.querySelector('.cal-label').textContent = '✓ Copié';
    window.setTimeout(() => {
      button.classList.remove('cal-copied');
      button.querySelector('.cal-label').textContent = oldText;
    }, 1100);
  }

  function updateCopyButton(button, value, emptyLabel = '') {
    const label = button._calLabel;
    button._calValue = value || '';
    button.disabled = !value && !button._calOnEmpty;
    button.querySelector('.cal-label').textContent = value
      ? `Copier ${label}`
      : (emptyLabel || `${label} indisponible`);
    button.querySelector('.cal-value').textContent = value || '—';
  }

  function makeButton(label, value, wide = false, onEmpty = null) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cal-copy-button${wide ? ' cal-wide' : ''}`;
    button.innerHTML = `<span class="cal-label"></span><span class="cal-value"></span>`;
    button._calLabel = label;
    button._calOnEmpty = onEmpty;
    updateCopyButton(button, value, onEmpty ? 'Recherche du résumé…' : '');
    button.addEventListener('click', async () => {
      if (button._calValue) await copyText(button._calValue, button);
      else if (button._calOnEmpty) await button._calOnEmpty(button);
    });
    return button;
  }

  function summaryControl() {
    return [...document.querySelectorAll('a, button, [role="button"], [role="tab"]')].find((element) => {
      if (element.closest(`#${PANEL_ID}`)) return false;
      if (!/^(resume|description)( du livre)?$/.test(comparable(element.textContent))) return false;
      if (element.matches('button, [role="button"], [role="tab"]')) return true;
      const href = element.getAttribute('href') || '';
      if (href.startsWith('#') || /^javascript:/i.test(href)) return true;
      try {
        const url = new URL(href, location.href);
        return url.origin === location.origin && url.pathname === location.pathname && Boolean(url.hash);
      } catch (_) {
        return false;
      }
    });
  }

  function describeSummaryElement(element) {
    if (!element) return null;
    const attributes = {};
    for (const name of ['id', 'class', 'href', 'role', 'aria-controls', 'data-target', 'data-bs-target', 'data-description', 'data-summary', 'data-resume']) {
      const value = element.getAttribute?.(name);
      if (value) attributes[name] = String(value).slice(0, 800);
    }
    return {
      tag: element.tagName,
      text: clean(element.textContent).slice(0, 1200),
      attributes,
    };
  }

  function summaryDiagnostic() {
    const labels = [...document.querySelectorAll('a, button, h1, h2, h3, h4, h5, span, strong, [role="heading"]')]
      .filter((element) => /resume|description/i.test(comparable(element.textContent)))
      .slice(0, 20)
      .map((element) => ({
        element: describeSummaryElement(element),
        next: describeSummaryElement(element.nextElementSibling),
        parentNext: describeSummaryElement(element.parentElement?.nextElementSibling),
      }));
    const containers = [...document.querySelectorAll('[id], [class], [data-description], [data-summary], [data-resume]')]
      .filter((element) => /resume|summary|synopsis|description/i.test(`${element.id} ${element.className}`))
      .slice(0, 20)
      .map(describeSummaryElement);
    return {
      version: '2.4.0',
      url: location.href,
      labels,
      containers,
      embeddedCandidates: embeddedSummaryCandidates().slice(0, 10).map(({ text, score }) => ({
        score,
        text: text.slice(0, 1500),
      })),
    };
  }

  async function copySummaryDiagnostic(button) {
    await writeClipboard(JSON.stringify(summaryDiagnostic(), null, 2));
    const oldLabel = button.querySelector('.cal-label').textContent;
    button.querySelector('.cal-label').textContent = '✓ Diagnostic résumé copié';
    window.setTimeout(() => {
      if (!button._calValue) button.querySelector('.cal-label').textContent = oldLabel;
    }, 1400);
  }

  async function findSummaryLater(button, reveal = false) {
    if (reveal) {
      const control = summaryControl();
      if (control) {
        control.click();
        await sleep(450);
      }
    }

    const delays = reveal ? [0, 250, 700, 1200] : [0, 350, 700, 1200, 2200, 4000, 6500];
    for (const delay of delays) {
      if (delay) await sleep(delay);
      const summary = readBookData().summary;
      if (summary) {
        updateCopyButton(button, summary);
        return summary;
      }
    }
    updateCopyButton(button, '', 'Copier le diagnostic résumé');
    return '';
  }

  async function handleMissingSummary(button) {
    updateCopyButton(button, '', 'Recherche du résumé…');
    const summary = await findSummaryLater(button, true);
    if (summary) await copyText(summary, button);
    else await copySummaryDiagnostic(button);
  }

  async function storedGet(key, fallback = null) {
    if (typeof gmApi?.getValue === 'function') return gmApi.getValue(key, fallback);
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  async function storedSet(key, value) {
    if (typeof gmApi?.setValue === 'function') return gmApi.setValue(key, value);
    localStorage.setItem(key, JSON.stringify(value));
  }

  async function storedDelete(key) {
    if (typeof gmApi?.deleteValue === 'function') return gmApi.deleteValue(key);
    localStorage.removeItem(key);
  }

  function parseResponse(response) {
    if (response?.response && typeof response.response === 'object') return response.response;
    const text = response?.responseText || response?.response || '';
    try {
      return JSON.parse(text);
    } catch (_) {
      return {};
    }
  }

  async function biblioscanRequest(path, apiKey, options = {}) {
    if (typeof gmApi?.xmlHttpRequest !== 'function') {
      throw new Error('Cette version de Userscripts ne fournit pas GM.xmlHttpRequest.');
    }

    const response = await gmApi.xmlHttpRequest({
      method: options.method || 'GET',
      url: BIBLIO_API + path,
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      data: options.body ? JSON.stringify(options.body) : undefined,
      responseType: 'json',
      timeout: 30000,
    });

    const body = parseResponse(response);
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(body.error || `Erreur BiblioScan ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  const sleep = (delay) => new Promise((resolve) => window.setTimeout(resolve, delay));

  async function finishBiblioscan(snapshot, apiKey, onProgress) {
    for (const delay of [500, 1000, 2000, 4000, 8000, 16000]) {
      if (snapshot.fresh || snapshot.state === 'error') break;
      if (!snapshot.barcodeScanId) break;
      await sleep(delay);
      snapshot = await biblioscanRequest(
        `/api/barcode/scan/${encodeURIComponent(snapshot.barcodeScanId)}`,
        apiKey
      );
      await onProgress(snapshot);
    }

    if (!snapshot.metadata) {
      throw new Error('Analyse encore en cours. Recharge la page dans quelques secondes : aucun nouveau crédit ne sera utilisé.');
    }
    return snapshot;
  }

  async function scanBiblioscan(isbn13, apiKey, onProgress) {
    const snapshot = await biblioscanRequest('/api/barcode/scan', apiKey, {
      method: 'POST',
      body: { ISBN: isbn13, db_lang: 'fr' },
    });
    await onProgress(snapshot);
    return finishBiblioscan(snapshot, apiKey, onProgress);
  }

  async function resumeBiblioscan(pending, apiKey, onProgress) {
    const snapshot = await biblioscanRequest(
      `/api/barcode/scan/${encodeURIComponent(pending.barcodeScanId)}`,
      apiKey
    );
    await onProgress(snapshot);
    return finishBiblioscan(snapshot, apiKey, onProgress);
  }

  function asPrice(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') {
      const number = Number(value.replace(',', '.').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(number) ? number : '';
    }
    return Number.isFinite(Number(value)) ? Number(value) : '';
  }

  function formatPrice(value) {
    const price = asPrice(value);
    return price === '' ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(price)} €`;
  }

  function formatWholePrice(value) {
    const price = asPrice(value);
    return price === '' ? '—' : `${Math.trunc(price)} €`;
  }

  function saleDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const compactDate = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) {
      return new Date(Date.UTC(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3])));
    }
    if (typeof value === 'number' && value > 1000000000) {
      return new Date(value < 100000000000 ? value * 1000 : value);
    }
    if (/[-/:T]/.test(String(value))) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  function formatSaleAge(value, now = new Date()) {
    const start = saleDate(value);
    if (!start) return clean(value) || '—';

    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (startDay > end) return '0j';

    let years = end.getUTCFullYear() - startDay.getUTCFullYear();
    let cursor = new Date(Date.UTC(
      startDay.getUTCFullYear() + years,
      startDay.getUTCMonth(),
      startDay.getUTCDate()
    ));
    if (cursor > end) {
      years -= 1;
      cursor = new Date(Date.UTC(
        startDay.getUTCFullYear() + years,
        startDay.getUTCMonth(),
        startDay.getUTCDate()
      ));
    }

    let months = (end.getUTCFullYear() - cursor.getUTCFullYear()) * 12
      + end.getUTCMonth() - cursor.getUTCMonth();
    let monthCursor = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + months,
      cursor.getUTCDate()
    ));
    if (monthCursor > end) {
      months -= 1;
      monthCursor = new Date(Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + months,
        cursor.getUTCDate()
      ));
    }

    const days = Math.floor((end - monthCursor) / 86400000);
    if (years > 0) return `${years}a${months ? `${months}m` : ''}`;
    if (months > 0) return `${months}m${days ? `${days}j` : ''}`;
    return `${days}j`;
  }

  function saleFromObject(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const entries = Object.entries(item);
    if (entries.length === 1 && /^\d{8}$/.test(entries[0][0]) && asPrice(entries[0][1]) !== '') {
      return { date: entries[0][0], price: entries[0][1] };
    }
    const keys = Object.keys(item);
    const priceKey = keys.find((key) => /^(price|amount|value|sale[_-]?price|sold[_-]?price|used[_-]?price|prix)$/i.test(key));
    const dateKey = keys.find((key) => /^(date|time|timestamp|sold[_-]?at|sale[_-]?date|age|ago|days[_-]?ago|label)$/i.test(key));
    if (!priceKey || !dateKey || asPrice(item[priceKey]) === '') return null;
    return { date: item[dateKey], price: item[priceKey] };
  }

  function collectArrayCandidates(value, path = '', found = []) {
    if (!value || typeof value !== 'object') return found;
    if (Array.isArray(value)) {
      const objectSales = value.map(saleFromObject).filter(Boolean);
      if (objectSales.length) found.push({ path, sales: objectSales, score: objectSales.length + 5 });

      const pairSales = value.map((item) => {
        if (!Array.isArray(item) || item.length < 2) return null;
        const firstPrice = asPrice(item[0]);
        const secondPrice = asPrice(item[1]);
        if (firstPrice !== '' && secondPrice === '') return { price: item[0], date: item[1] };
        if (secondPrice !== '') return { date: item[0], price: item[1] };
        return null;
      }).filter(Boolean);
      if (pairSales.length) found.push({ path, sales: pairSales, score: pairSales.length + 3 });
      return found;
    }

    for (const [key, child] of Object.entries(value)) {
      collectArrayCandidates(child, path ? `${path}.${key}` : key, found);
    }
    return found;
  }

  function pairParallelArrays(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const entries = Object.entries(value).filter(([, child]) => Array.isArray(child));
    const dates = entries.filter(([key]) => /(sale|sold|vente).*(date|time|ago)|(date|time).*(sale|sold|vente)/i.test(key));
    const prices = entries.filter(([key]) => /(sale|sold|vente).*(price|amount|prix)|(price|amount|prix).*(sale|sold|vente)/i.test(key));

    for (const [, dateValues] of dates) {
      for (const [, priceValues] of prices) {
        if (dateValues.length && dateValues.length === priceValues.length) {
          return dateValues.map((date, index) => ({ date, price: priceValues[index] }));
        }
      }
    }

    for (const child of Object.values(value)) {
      const nested = pairParallelArrays(child);
      if (nested.length) return nested;
    }
    return [];
  }

  function extractRecentSales(snapshot) {
    const metadata = snapshot?.metadata || {};
    const parallel = pairParallelArrays(metadata);
    const candidates = collectArrayCandidates(metadata)
      .map((candidate) => ({
        ...candidate,
        score: candidate.score + (/(last.*sale|sale.*history|sold|vente|historique)/i.test(candidate.path) ? 20 : 0),
      }))
      .sort((a, b) => b.score - a.score);

    const sales = parallel.length ? parallel : (candidates[0]?.sales || []);
    const recent = sales
      .filter((sale) => asPrice(sale.price) !== '')
      .slice(0, 5);
    if (recent.length && recent.every((sale) => /^\d{8}$/.test(String(sale.date)))) {
      recent.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return recent;
  }

  async function enrichSalesSnapshot(snapshot, apiKey) {
    if (extractRecentSales(snapshot).length) return snapshot;
    const asin = clean(snapshot?.metadata?.sources?.keepa?.asin);
    if (!asin) return snapshot;

    const detail = await biblioscanRequest(`/api/metadata/${encodeURIComponent(asin)}`, apiKey);
    const metadata = detail?.metadata || (detail?.sources ? detail : null);
    return metadata ? { ...snapshot, metadata } : snapshot;
  }

  function diagnosticShape(value, depth = 0) {
    if (depth > 6) return '[profondeur limitée]';
    if (Array.isArray(value)) {
      return {
        length: value.length,
        sample: value.slice(0, 12).map((item) => diagnosticShape(item, depth + 1)),
      };
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, diagnosticShape(child, depth + 1)])
      );
    }
    if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
    return value;
  }

  async function copySalesDiagnostic(snapshot, isbn13, button) {
    const diagnostic = {
      isbn13,
      version: '2.3.0',
      metadata: diagnosticShape(snapshot?.metadata || {}),
    };
    await writeClipboard(JSON.stringify(diagnostic, null, 2));
    const oldLabel = button.textContent;
    button.textContent = '✓ Diagnostic copié';
    window.setTimeout(() => { button.textContent = oldLabel; }, 1300);
  }

  function biblioElements() {
    const root = document.querySelector(`#${PANEL_ID} .cal-biblio`);
    return {
      root,
      status: root?.querySelector('.cal-biblio-status'),
      content: root?.querySelector('.cal-biblio-content'),
      actions: root?.querySelector('.cal-biblio-actions'),
    };
  }

  function setBiblioMessage(message, tone = '') {
    const { status, content } = biblioElements();
    if (!status || !content) return;
    status.className = `cal-biblio-status ${tone}`;
    status.textContent = message;
    content.replaceChildren();
  }

  function actionButton(label, handler, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cal-biblio-button${secondary ? ' secondary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function renderSales(snapshot, isbn13, savedAt) {
    const { status, content, actions } = biblioElements();
    if (!status || !content || !actions) return;
    const keepa = snapshot?.metadata?.sources?.keepa || {};
    const sales = extractRecentSales(snapshot);
    const fiveSalesAverage = sales.length
      ? sales.reduce((total, sale) => total + asPrice(sale.price), 0) / sales.length
      : '';
    status.className = 'cal-biblio-status success';
    status.textContent = `Données BiblioScan${savedAt ? ` · cache du ${new Date(savedAt).toLocaleDateString('fr-FR')}` : ''}`;
    content.replaceChildren();

    const metrics = document.createElement('div');
    metrics.className = 'cal-biblio-metrics';
    metrics.innerHTML = `
      <span><b>${keepa.freq12 ?? '—'}</b> ventes / 12 mois</span>
      <span>Moy. ${sales.length || 5} ventes : <b>${formatPrice(fiveSalesAverage)}</b></span>
    `;
    content.appendChild(metrics);

    if (sales.length) {
      const table = document.createElement('table');
      table.className = 'cal-sales-table';
      table.innerHTML = '<tbody><tr class="cal-sale-dates"><th>Vendu il y a</th></tr><tr class="cal-sale-prices"><th>Au prix de</th></tr></tbody>';
      const body = table.querySelector('tbody');
      const dateRow = body.querySelector('.cal-sale-dates');
      const priceRow = body.querySelector('.cal-sale-prices');
      sales.forEach((sale) => {
        const date = document.createElement('td');
        const price = document.createElement('td');
        date.textContent = formatSaleAge(sale.date);
        price.textContent = formatWholePrice(sale.price);
        dateRow.appendChild(date);
        priceRow.appendChild(price);
      });
      content.appendChild(table);
    } else {
      const notice = document.createElement('p');
      notice.className = 'cal-biblio-notice';
      notice.textContent = 'BiblioScan n’a pas fourni les 5 ventes dans un format reconnu. Copie le diagnostic et envoie-le-moi : il ne contient pas ta clé API.';
      content.appendChild(notice);

      const diagnosticButton = actionButton('Copier le diagnostic ventes', () => (
        copySalesDiagnostic(snapshot, isbn13, diagnosticButton)
      ), true);
      content.appendChild(diagnosticButton);
    }

    const link = document.createElement('a');
    link.className = 'cal-biblio-link';
    link.href = `${BIBLIO_API}/barcode/${isbn13}?db_lang=fr`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Ouvrir la fiche BiblioScan ↗';
    content.appendChild(link);
  }

  async function configureBiblio(isbn13) {
    const value = window.prompt(
      'Colle ta clé API BiblioScan (elle commence par bsk_). Elle restera uniquement dans Userscripts sur cet appareil.'
    );
    if (value === null) return;
    const key = clean(value);
    if (!/^bsk_[a-f0-9]{48}$/i.test(key)) {
      window.alert('Clé invalide : elle doit commencer par bsk_ et contenir 48 caractères hexadécimaux ensuite.');
      return;
    }
    await storedSet(BIBLIO_KEY_STORAGE, key);
    await loadBiblioscan(isbn13, true);
  }

  async function loadBiblioscan(isbn13, forceRefresh = false) {
    const { actions } = biblioElements();
    if (!actions || !isbn13) {
      setBiblioMessage('ISBN-13 introuvable : analyse BiblioScan impossible.', 'error');
      return;
    }

    actions.replaceChildren();
    const cacheKey = BIBLIO_CACHE_PREFIX + isbn13;
    const cached = await storedGet(cacheKey);
    if (cached?.snapshot && !forceRefresh) {
      let cachedSnapshot = cached.snapshot;
      const cachedApiKey = await storedGet(BIBLIO_KEY_STORAGE, '');
      if (cachedApiKey && !extractRecentSales(cachedSnapshot).length) {
        setBiblioMessage('Récupération gratuite de l’historique détaillé…', 'loading');
        try {
          cachedSnapshot = await enrichSalesSnapshot(cachedSnapshot, cachedApiKey);
          await storedSet(cacheKey, { ...cached, snapshot: cachedSnapshot });
        } catch (_) {
          // Les données principales restent utilisables si l’endpoint détaillé échoue.
        }
      }
      renderSales(cachedSnapshot, isbn13, cached.savedAt);
      actions.append(
        actionButton('Actualiser · 1 crédit', () => loadBiblioscan(isbn13, true), true),
        actionButton('Changer la clé', () => configureBiblio(isbn13), true)
      );
      return;
    }

    const apiKey = await storedGet(BIBLIO_KEY_STORAGE, '');
    if (!apiKey) {
      setBiblioMessage('Clé API nécessaire pour charger automatiquement les ventes.', '');
      actions.append(actionButton('Configurer BiblioScan', () => configureBiblio(isbn13)));
      return;
    }

    const pending = !forceRefresh && cached?.pending?.barcodeScanId ? cached.pending : null;
    setBiblioMessage(
      pending
        ? `Reprise de l’analyse de ${isbn13}… aucun nouveau crédit.`
        : `Analyse automatique de ${isbn13}… 1 crédit sera utilisé.`,
      'loading'
    );
    actions.append(actionButton('Changer la clé', () => configureBiblio(isbn13), true));

    try {
      const savePending = async (snapshot) => {
        if (snapshot?.barcodeScanId && !snapshot.metadata) {
          await storedSet(cacheKey, { pending: snapshot });
        }
      };
      let snapshot = pending
        ? await resumeBiblioscan(pending, apiKey, savePending)
        : await scanBiblioscan(isbn13, apiKey, savePending);
      try {
        snapshot = await enrichSalesSnapshot(snapshot, apiKey);
      } catch (_) {
        // Le scan principal reste affiché même si l’historique détaillé est indisponible.
      }
      const cache = { savedAt: Date.now(), snapshot };
      await storedSet(cacheKey, cache);
      renderSales(snapshot, isbn13, cache.savedAt);
      actions.replaceChildren(
        actionButton('Actualiser · 1 crédit', () => loadBiblioscan(isbn13, true), true),
        actionButton('Changer la clé', () => configureBiblio(isbn13), true)
      );
    } catch (error) {
      if (error.status === 401) await storedDelete(BIBLIO_KEY_STORAGE);
      const latestCache = await storedGet(cacheKey);
      const canResume = error.status !== 401 && Boolean(latestCache?.pending?.barcodeScanId);
      setBiblioMessage(error.status === 401 ? 'Clé refusée ou expirée.' : error.message, 'error');
      actions.replaceChildren(
        actionButton(error.status === 401 ? 'Remplacer la clé' : (canResume ? 'Continuer sans nouveau crédit' : 'Réessayer · 1 crédit'), () => (
          error.status === 401 ? configureBiblio(isbn13) : loadBiblioscan(isbn13, !canResume)
        )),
        actionButton('Ouvrir BiblioScan', () => window.open(`${BIBLIO_API}/barcode/${isbn13}?db_lang=fr`, '_blank'), true)
      );
    }
  }

  function install(attempt = 0) {
    if (document.getElementById(PANEL_ID)) return;

    const data = readBookData();
    if (!data.title && attempt < RETRIES) {
      window.setTimeout(() => install(attempt + 1), RETRY_DELAY);
      return;
    }

    if (!data.title) return;

    const fullBlock = [
      `Titre : ${data.title}`,
      `Auteur : ${data.author || 'Non indiqué'}`,
      `Éditeur : ${data.publisher || 'Non indiqué'}`,
    ].join('\n');

    const style = document.createElement('style');
    style.textContent = `
      #${PANEL_ID} {
        position: relative;
        z-index: 2147483646;
        box-sizing: border-box;
        width: 100%;
        padding: max(8px, env(safe-area-inset-top)) 8px 9px;
        color: #17211b;
        background: linear-gradient(145deg, #f4fff7, #e5f7eb);
        border-bottom: 2px solid #237a45;
        box-shadow: 0 4px 16px rgba(18, 58, 33, .18);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .cal-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 7px;
        margin: 0 0 6px;
        font-size: 15px;
        font-weight: 800;
      }
      #${PANEL_ID} .cal-hint { color: #4d6756; font-size: 11px; font-weight: 600; }
      #${PANEL_ID} .cal-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px;
      }
      #${PANEL_ID} .cal-copy-button {
        min-width: 0;
        min-height: 45px;
        margin: 0;
        padding: 6px 8px;
        appearance: none;
        -webkit-appearance: none;
        touch-action: manipulation;
        text-align: left;
        color: #183d27;
        background: #fff;
        border: 1px solid #9ccbad;
        border-radius: 9px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, .07);
        font: inherit;
      }
      #${PANEL_ID} .cal-copy-button:active { transform: scale(.98); background: #eaf8ee; }
      #${PANEL_ID} .cal-copy-button.cal-copied { color: #fff; background: #237a45; }
      #${PANEL_ID} .cal-copy-button:disabled { opacity: .55; }
      #${PANEL_ID} .cal-wide { grid-column: 1 / -1; }
      #${PANEL_ID} .cal-label { display: block; margin-bottom: 2px; font-size: 12px; line-height: 1.15; font-weight: 800; }
      #${PANEL_ID} .cal-value {
        display: -webkit-box;
        overflow: hidden;
        color: inherit;
        font-size: 10.5px;
        line-height: 1.15;
        overflow-wrap: anywhere;
        opacity: .82;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
      }
      #${PANEL_ID} .cal-biblio {
        margin-top: 8px;
        padding: 9px;
        background: #fff;
        border: 1px solid #9ccbad;
        border-radius: 9px;
      }
      #${PANEL_ID} .cal-biblio-title { margin: 0 0 3px; font-size: 14px; font-weight: 850; }
      #${PANEL_ID} .cal-biblio-status { margin: 0 0 7px; color: #52685a; font-size: 11px; }
      #${PANEL_ID} .cal-biblio-status.loading { color: #805c00; }
      #${PANEL_ID} .cal-biblio-status.success { color: #237a45; }
      #${PANEL_ID} .cal-biblio-status.error { color: #a12626; }
      #${PANEL_ID} .cal-biblio-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px;
        margin-bottom: 7px;
      }
      #${PANEL_ID} .cal-biblio-metrics span { padding: 6px; background: #eef8f1; border-radius: 7px; font-size: 11px; }
      #${PANEL_ID} .cal-sales-table { width: 100%; margin: 3px 0 7px; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
      #${PANEL_ID} .cal-sales-table th, #${PANEL_ID} .cal-sales-table td {
        padding: 5px 2px;
        text-align: center;
        white-space: nowrap;
        border: 1px solid #c8ddd0;
      }
      #${PANEL_ID} .cal-sales-table th { width: 62px; text-align: left; background: #eef8f1; }
      #${PANEL_ID} .cal-biblio-notice { margin: 6px 0; font-size: 11px; line-height: 1.3; }
      #${PANEL_ID} .cal-biblio-link { display: inline-block; margin: 2px 0 6px; color: #176b39; font-size: 12px; font-weight: 750; }
      #${PANEL_ID} .cal-biblio-actions { display: flex; flex-wrap: wrap; gap: 5px; }
      #${PANEL_ID} .cal-biblio-button {
        min-height: 34px;
        padding: 6px 9px;
        color: #fff;
        background: #237a45;
        border: 0;
        border-radius: 9px;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
      }
      #${PANEL_ID} .cal-biblio-button.secondary { color: #235333; background: #e7f4eb; }
      @media (min-width: 760px) {
        #${PANEL_ID} .cal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        #${PANEL_ID} .cal-wide { grid-column: span 3; }
      }
    `;

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Copie rapide des informations du livre');
    panel.innerHTML = `
      <div class="cal-heading">
        <span>📚 Copie rapide</span>
        <span class="cal-hint">Touchez un bloc</span>
      </div>
      <div class="cal-grid"></div>
      <div class="cal-biblio">
        <div class="cal-biblio-title">📈 5 dernières ventes BiblioScan</div>
        <p class="cal-biblio-status">Préparation…</p>
        <div class="cal-biblio-content"></div>
        <div class="cal-biblio-actions"></div>
      </div>
    `;

    const grid = panel.querySelector('.cal-grid');
    const summaryButton = makeButton('le résumé', data.summary, false, handleMissingSummary);
    grid.append(
      makeButton('le bloc titre + auteur + éditeur', fullBlock, true),
      makeButton('le titre', data.title),
      makeButton("l’auteur", data.author),
      makeButton("l’éditeur", data.publisher),
      makeButton("l’ISBN-13", data.isbn13),
      makeButton('le poids', data.weight),
      summaryButton
    );

    document.head.appendChild(style);
    document.body.prepend(panel);
    loadBiblioscan(data.isbn13);
    if (!data.summary) findSummaryLater(summaryButton);
  }

  install();
})();
