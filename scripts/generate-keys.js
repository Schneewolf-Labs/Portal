#!/usr/bin/env node
// Prints a fresh pair of strong keys in .env format.
const { generateKey } = require('../src/Config');

console.log('# Add these lines to your .env file:');
console.log(`PORTAL_REGISTER_KEY=${generateKey()}`);
console.log(`PORTAL_JOIN_KEY=${generateKey()}`);
