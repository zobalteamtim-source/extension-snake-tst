
// content.js

let tooltip = null;
let currentTarget = null;
let debounceTimer = null;

function createTooltip() {
    if (tooltip) return;
    tooltip = document.createElement('div');
    tooltip.id = 'momox-price-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
}

function showTooltip(x, y, htmlContent) {
    if (!tooltip) createTooltip();
    tooltip.innerHTML = htmlContent;
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.style.display = 'block';
}

function hideTooltip() {
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('a');

    if (!target || !target.href) {
        return;
    }

    // Debounce to avoid processing every quick movement
    clearTimeout(debounceTimer);
    currentTarget = target;

    debounceTimer = setTimeout(() => {
        if (currentTarget !== target) return;

        const url = target.href;
        // Use Utils from global scope (injected via manifest)
        const id = window.Utils.getASIN(url);

        if (id) {
            const ean = window.Utils.convertToEAN13(id);
            if (ean) {
                // Show loading
                showTooltip(event.clientX, event.clientY, '<span class="loading">Recherche prix Momox...</span>');

                // Send message to background
                chrome.runtime.sendMessage({ type: 'GET_PRICE', ean: ean }, (response) => {
                    // Verify if we are still hovering the same element (approx) or just update tooltip
                    // Ideally we should check if tooltip is still visible/relevant.

                    if (chrome.runtime.lastError) {
                        showTooltip(event.clientX, event.clientY, '<span class="error">Erreur extension</span>');
                        return;
                    }

                    if (response && response.price) {
                         showTooltip(event.clientX, event.clientY, `Momox: <span class="price">${response.price}</span>`);
                    } else if (response && response.error) {
                         showTooltip(event.clientX, event.clientY, `<span class="error">Momox: ${response.error}</span>`);
                    } else {
                         showTooltip(event.clientX, event.clientY, '<span class="error">Momox: Indisponible</span>');
                    }
                });
            }
        }
    }, 300); // 300ms delay
});

document.addEventListener('mouseout', (event) => {
    const target = event.target.closest('a');
    if (target) {
        clearTimeout(debounceTimer);
        hideTooltip();
        currentTarget = null;
    }
});

// Update tooltip position while moving inside the link
document.addEventListener('mousemove', (event) => {
    if (tooltip && tooltip.style.display === 'block') {
         tooltip.style.left = (event.clientX + 15) + 'px';
         tooltip.style.top = (event.clientY + 15) + 'px';
    }
});
