
// Utility functions for Momox Price Checker

/**
 * Extracts ASIN or EAN from a given URL.
 * ASIN is usually 10 chars, EAN is 13 digits.
 * @param {string} url
 * @returns {string|null} The identifier or null.
 */
function getASIN(url) {
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname;
        const query = urlObj.searchParams;

        // Common patterns
        // /dp/B00...
        // /product/B00...
        // /gp/product/B00...
        // /.../dp/B00...

        // Regex for ASIN (10 chars, alphanumeric, usually starts with B or is ISBN)
        // Strictly speaking ASIN is 10 chars.
        // ISBN-10 is 10 chars.
        // EAN is 13 digits.

        // Look for ISBN-13 (978...) in path or query
        const eanMatch = path.match(/(978\d{10})/);
        if (eanMatch) return eanMatch[1];

        const queryEan = query.get('searchparam') || query.get('q'); // support some search params
        if (queryEan && queryEan.match(/^978\d{10}$/)) return queryEan;

        // Look for ASIN/ISBN-10
        // ASIN regex: 10 chars, alphanumeric.
        // Amazon URLs: /dp/ASIN, /gp/product/ASIN
        const asinMatch = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
        if (asinMatch) return asinMatch[1];

        // Fallback: strictly looking for a 10-char alphanum string surrounded by slashes might be too broad
        // But let's try to capture segments that look like ASINs.
        // For Amazon, it is quite specific.

        // Maybe the user hovers a link like `https://www.amazon.fr/Title-Author/dp/ASIN`

        // Check for generic ASIN in path
        const genericAsin = path.match(/\/([A-Z0-9]{10})(?:\/|$|\?)/);
        // We need to be careful not to match random strings.
        // Amazon ASINs usually start with B for non-books, or are digits/X for books.

        if (genericAsin) {
            // Verify checksum or structure?
            // For now, return if it looks like an ASIN.
            return genericAsin[1];
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Converts ISBN-10 (ASIN) to ISBN-13 (EAN).
 * Returns the input if it's already 13 digits.
 * Returns null if invalid.
 * @param {string} identifier
 * @returns {string|null}
 */
function convertToEAN13(identifier) {
    if (!identifier) return null;

    // Clean identifier
    const cleanId = identifier.replace(/[- ]/g, '');

    // If already 13 digits, return it
    if (/^\d{13}$/.test(cleanId)) return cleanId;

    // If not 10 chars, return null (assuming we only convert 10->13)
    if (cleanId.length !== 10) return null;

    // Check if it is a valid ISBN-10 (books usually).
    // If it starts with 'B', it's an Amazon proprietary ASIN, usually no EAN mapping without API.
    // The user specifically asked for books ("livre") and transforming ASIN to EAN13.
    // ISBN-10 to 13: prefix 978, recompute checksum.

    // If it starts with a letter (like B), it's likely not convertible to ISBN-13 algorithmically.
    if (/^[A-Z]/.test(cleanId)) {
        // We cannot convert generic Amazon ASIN to EAN without an API lookup.
        // But we will return null or maybe the ASIN itself if the caller handles it?
        // The prompt says "si ya un asin dans l'url faudrait le transfortmer en ean13".
        // This implies it IS a book and thus has an ISBN-10 underlying the ASIN.
        // ISBN-10s for books are digits (last char can be X).
        return null;
    }

    const prefix = "978";
    const core = prefix + cleanId.substring(0, 9);

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(core[i]) * (i % 2 === 0 ? 1 : 3);
    }

    const remainder = sum % 10;
    const checkDigit = remainder === 0 ? 0 : 10 - remainder;

    return core + checkDigit;
}

// Export for Node.js testing, standard window global for browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getASIN, convertToEAN13 };
} else {
    window.Utils = { getASIN, convertToEAN13 };
}
