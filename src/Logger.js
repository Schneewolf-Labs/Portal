class Logger {
	constructor() {
		this.levels = {
			DEBUG: 0,
			INFO: 1,
			WARN: 2,
			ERROR: 3
		};
		// Set default log level from environment or INFO
		const envLevel = process.env.LOG_LEVEL || 'INFO';
		this.currentLevel = this.levels[envLevel] || this.levels.INFO;
	}

	_log(level, message, ...args) {
		if (this.levels[level] >= this.currentLevel) {
			const timestamp = new Date().toISOString();
			const formattedMessage = `[${timestamp}] [${level}] ${message}`;

			switch (level) {
				case 'ERROR':
					console.error(formattedMessage, ...args);
					break;
				case 'WARN':
					console.warn(formattedMessage, ...args);
					break;
				default:
					console.log(formattedMessage, ...args);
			}
		}
	}

	debug(message, ...args) {
		this._log('DEBUG', message, ...args);
	}

	info(message, ...args) {
		this._log('INFO', message, ...args);
	}

	warn(message, ...args) {
		this._log('WARN', message, ...args);
	}

	error(message, ...args) {
		this._log('ERROR', message, ...args);
	}
}

// Export singleton instance
module.exports = new Logger();
