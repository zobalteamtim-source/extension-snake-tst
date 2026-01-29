
const assert = require('assert');
const { getASIN, convertToEAN13 } = require('./utils.js');

console.log("Running tests...");

// Test getASIN
assert.strictEqual(getASIN('https://www.amazon.fr/dp/2912759108'), '2912759108');
assert.strictEqual(getASIN('https://www.amazon.fr/Some-Book/dp/2912759108/ref=sr_1_1'), '2912759108');
assert.strictEqual(getASIN('https://www.momox-shop.fr/search?searchparam=9782912759108'), '9782912759108');

// Test convertToEAN13
const isbn10 = '2912759108'; // From prompt example
const isbn13 = '9782912759108'; // Expected

const converted = convertToEAN13(isbn10);
console.log(`Converted ${isbn10} -> ${converted}`);
assert.strictEqual(converted, isbn13);

// Test invalid/non-convertible
const asinNonBook = 'B08XYZ1234';
assert.strictEqual(convertToEAN13(asinNonBook), null);

console.log("All tests passed!");
