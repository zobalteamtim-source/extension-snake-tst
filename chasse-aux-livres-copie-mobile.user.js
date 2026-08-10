// ==UserScript==
// @name         Chasse aux Livres — copie rapide mobile
// @namespace    https://www.chasse-aux-livres.fr/
// @version      1.0.0
// @description  Place en haut des fiches livre des boutons pour copier titre, auteur, éditeur, ISBN-13 et poids.
// @author       Vous
// @match        https://www.chasse-aux-livres.fr/prix/*
// @match        https://chasse-aux-livres.fr/prix/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'cal-copie-rapide';
  const RETRIES = 20;
  const RETRY_DELAY = 500;

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

    return { title, author, publisher, isbn13, weight };
  }

  async function copyText(text, button) {
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

    const oldText = button.querySelector('.cal-label').textContent;
    button.classList.add('cal-copied');
    button.querySelector('.cal-label').textContent = '✓ Copié';
    window.setTimeout(() => {
      button.classList.remove('cal-copied');
      button.querySelector('.cal-label').textContent = oldText;
    }, 1100);
  }

  function makeButton(label, value, wide = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cal-copy-button${wide ? ' cal-wide' : ''}`;
    button.disabled = !value;
    button.innerHTML = `<span class="cal-label"></span><span class="cal-value"></span>`;
    button.querySelector('.cal-label').textContent = value ? `Copier ${label}` : `${label} indisponible`;
    button.querySelector('.cal-value').textContent = value || '—';
    button.addEventListener('click', () => copyText(value, button));
    return button;
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
        padding: max(12px, env(safe-area-inset-top)) 12px 14px;
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
        gap: 10px;
        margin: 0 0 10px;
        font-size: 17px;
        font-weight: 800;
      }
      #${PANEL_ID} .cal-hint { color: #4d6756; font-size: 12px; font-weight: 600; }
      #${PANEL_ID} .cal-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      #${PANEL_ID} .cal-copy-button {
        min-width: 0;
        min-height: 64px;
        margin: 0;
        padding: 10px 11px;
        appearance: none;
        -webkit-appearance: none;
        touch-action: manipulation;
        text-align: left;
        color: #183d27;
        background: #fff;
        border: 1px solid #9ccbad;
        border-radius: 12px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, .07);
        font: inherit;
      }
      #${PANEL_ID} .cal-copy-button:active { transform: scale(.98); background: #eaf8ee; }
      #${PANEL_ID} .cal-copy-button.cal-copied { color: #fff; background: #237a45; }
      #${PANEL_ID} .cal-copy-button:disabled { opacity: .55; }
      #${PANEL_ID} .cal-wide { grid-column: 1 / -1; }
      #${PANEL_ID} .cal-label { display: block; margin-bottom: 4px; font-size: 14px; font-weight: 800; }
      #${PANEL_ID} .cal-value {
        display: -webkit-box;
        overflow: hidden;
        color: inherit;
        font-size: 12px;
        line-height: 1.25;
        overflow-wrap: anywhere;
        opacity: .82;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
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
    `;

    const grid = panel.querySelector('.cal-grid');
    grid.append(
      makeButton('le bloc titre + auteur + éditeur', fullBlock, true),
      makeButton('le titre', data.title),
      makeButton("l’auteur", data.author),
      makeButton("l’éditeur", data.publisher),
      makeButton("l’ISBN-13", data.isbn13),
      makeButton('le poids', data.weight)
    );

    document.head.appendChild(style);
    document.body.prepend(panel);
  }

  install();
})();
