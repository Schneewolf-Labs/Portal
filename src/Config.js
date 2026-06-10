const crypto = require('crypto');

const MIN_KEY_LENGTH = 16;

// Known weak values that must never be accepted, even if long enough
const FORBIDDEN_KEYS = new Set([
	'1234567890',
	'changeme',
	'secret',
	'password',
	'your-secure-register-key',
	'your-secure-join-key'
]);

function generateKey() {
	return crypto.randomBytes(32).toString('hex');
}

function validateKey(name, value, errors) {
	if (!value) {
		errors.push(`${name} is not set.`);
		return;
	}
	if (value.length < MIN_KEY_LENGTH) {
		errors.push(`${name} must be at least ${MIN_KEY_LENGTH} characters long.`);
	}
	if (FORBIDDEN_KEYS.has(value.toLowerCase())) {
		errors.push(`${name} is set to a well-known placeholder value.`);
	}
}

function parsePositiveInt(name, value, fallback, errors) {
	if (value === undefined || value === '') return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		errors.push(`${name} must be a positive integer (got "${value}").`);
		return fallback;
	}
	return parsed;
}

// Builds and validates server configuration from environment variables.
// Throws an Error with a human-readable, actionable message if invalid.
function loadConfig(env = process.env) {
	const errors = [];

	const registerKey = env.PORTAL_REGISTER_KEY;
	const joinKey = env.PORTAL_JOIN_KEY;
	validateKey('PORTAL_REGISTER_KEY', registerKey, errors);
	validateKey('PORTAL_JOIN_KEY', joinKey, errors);
	if (registerKey && joinKey && registerKey === joinKey) {
		errors.push('PORTAL_REGISTER_KEY and PORTAL_JOIN_KEY must be different, otherwise any client can register as a portal.');
	}

	const config = {
		port: parsePositiveInt('PORTAL_LISTEN_PORT', env.PORTAL_LISTEN_PORT, 3069, errors),
		registerKey,
		joinKey,
		maxPayloadBytes: parsePositiveInt('PORTAL_MAX_PAYLOAD_BYTES', env.PORTAL_MAX_PAYLOAD_BYTES, 64 * 1024, errors),
		maxConnections: parsePositiveInt('PORTAL_MAX_CONNECTIONS', env.PORTAL_MAX_CONNECTIONS, 1000, errors),
		authTimeoutMs: parsePositiveInt('PORTAL_AUTH_TIMEOUT_MS', env.PORTAL_AUTH_TIMEOUT_MS, 10000, errors),
		heartbeatIntervalMs: parsePositiveInt('PORTAL_HEARTBEAT_INTERVAL_MS', env.PORTAL_HEARTBEAT_INTERVAL_MS, 30000, errors),
		maxAuthFailuresPerMinute: parsePositiveInt('PORTAL_MAX_AUTH_FAILURES_PER_MINUTE', env.PORTAL_MAX_AUTH_FAILURES_PER_MINUTE, 10, errors)
	};

	if (errors.length > 0) {
		throw new Error(
			'Invalid configuration:\n' +
			errors.map((e) => `  - ${e}`).join('\n') +
			'\n\nGenerate strong keys with:\n' +
			'  npm run generate-keys\n' +
			'then copy the output into your .env file (see .env.example).'
		);
	}

	return config;
}

module.exports = { loadConfig, generateKey, MIN_KEY_LENGTH };
