// ==========================================
// LOGGER - Hệ thống ghi log màu sắc + file + EventEmitter (Web Dashboard)
// ==========================================
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('../config/config');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const logEmitter = new EventEmitter();
const recentLogs = []; // Buffer 100 logs mới nhất cho Dashboard
const MAX_LOG_BUFFER = 100;

const logFile = path.join(config.paths.logs, `run-${new Date().toISOString().split('T')[0]}.log`);

function writeToFile(level, module, message) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const line = `[${new Date().toISOString()}] [${level}] [${module}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (e) { /* ignore log file errors */ }

  const logEntry = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    time,
    level,
    module,
    message
  };

  recentLogs.push(logEntry);
  if (recentLogs.length > MAX_LOG_BUFFER) {
    recentLogs.shift();
  }

  logEmitter.emit('log', logEntry);
}

const logger = {
  emitter: logEmitter,
  getRecentLogs: () => [...recentLogs],

  info: (module, message) => {
    const line = `${colors.cyan}[INFO]${colors.reset} ${colors.bright}[${module}]${colors.reset} ${message}`;
    console.log(line);
    writeToFile('INFO', module, message);
  },
  success: (module, message) => {
    const line = `${colors.green}[✅ OK]${colors.reset} ${colors.bright}[${module}]${colors.reset} ${message}`;
    console.log(line);
    writeToFile('SUCCESS', module, message);
  },
  warn: (module, message) => {
    const line = `${colors.yellow}[⚠️  WARN]${colors.reset} ${colors.bright}[${module}]${colors.reset} ${message}`;
    console.log(line);
    writeToFile('WARN', module, message);
  },
  error: (module, message) => {
    const line = `${colors.red}[❌ ERR]${colors.reset} ${colors.bright}[${module}]${colors.reset} ${message}`;
    console.error(line);
    writeToFile('ERROR', module, message);
  },
  step: (step, total, message) => {
    const line = `${colors.magenta}[STEP ${step}/${total}]${colors.reset} ${message}`;
    console.log(line);
    writeToFile('STEP', `${step}/${total}`, message);
  },
};

module.exports = logger;
