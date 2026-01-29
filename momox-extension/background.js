
// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PRICE') {
    fetchPrice(message.ean)
      .then(result => {
        if (result) {
            sendResponse({ price: result });
        } else {
            sendResponse({ error: 'Non trouvé' });
        }
      })
      .catch(err => {
        console.error("Error fetching price:", err);
        sendResponse({ error: 'Erreur réseau' });
      });
    return true; // Keep channel open for async response
  }
});

async function fetchPrice(ean) {
    const url = `https://www.momox-shop.fr/produits-C0/?fcIsSearch=1&searchparam=${ean}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            console.warn("Momox returned status:", response.status);
            return null;
        }

        const text = await response.text();

        // Check for Cloudflare block
        if (text.includes('Cloudflare') && (text.includes('Attention Required') || text.includes('security service'))) {
             console.warn("Blocked by Cloudflare");
             return "Blocked (CF)";
        }

        // Robust Regex for French price: digits, comma, 2 digits, optional space, €
        // Examples: "12,50 €", "9,99€"
        // We look for the first match which is usually the main product price in search results.
        // Momox HTML often uses <div class="price">...</div> or similar.
        const priceRegex = /(\d+,\d{2})\s*€/;
        const match = text.match(priceRegex);

        if (match) {
            return match[0]; // e.g., "12,50 €"
        }

        // Alternative: Look for Schema.org JSON-LD
        // "offers": { ..., "price": "12.50", "priceCurrency": "EUR" }
        const jsonLdMatch = text.match(/"price"\s*:\s*"(\d+\.\d+)"/);
        if (jsonLdMatch) {
            return jsonLdMatch[1].replace('.', ',') + " €";
        }

        return null; // Not found
    } catch (error) {
        console.error("Fetch error:", error);
        return null;
    }
}
