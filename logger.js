const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.currentDate = this.getDateString();
    this.logFile = null;
    this.init();
  }

  init() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.rotateIfNeeded();
  }

  getDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  getLogFileName() {
    return path.join(this.logDir, `app-${this.currentDate}.log`);
  }

  rotateIfNeeded() {
    const today = this.getDateString();
    if (today !== this.currentDate) {
      // 压缩昨天的日志
      if (this.logFile) {
        this.compressLog(this.getLogFileName());
      }
      this.currentDate = today;
    }
    this.logFile = this.getLogFileName();
  }

  compressLog(logPath) {
    if (!fs.existsSync(logPath)) return;

    const gzipPath = logPath + '.gz';
    const input = fs.createReadStream(logPath);
    const output = fs.createWriteStream(gzipPath);
    const gzip = zlib.createGzip();

    input.pipe(gzip).pipe(output);

    output.on('finish', () => {
      fs.unlinkSync(logPath);
    });
  }

  write(level, message, meta = {}) {
    this.rotateIfNeeded();

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    // 写入文件
    fs.appendFileSync(this.logFile, logLine);

    // 同时输出到控制台
    const consoleMsg = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    if (level === 'error') {
      console.error(consoleMsg, meta);
    } else {
      console.log(consoleMsg, meta);
    }
  }

  info(message, meta) {
    this.write('info', message, meta);
  }

  warn(message, meta) {
    this.write('warn', message, meta);
  }

  error(message, meta) {
    this.write('error', message, meta);
  }

  getLogs(limit = 100) {
    const logFile = this.getLogFileName();
    if (!fs.existsSync(logFile)) {
      return [];
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);
    const logs = lines.slice(-limit).map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { raw: line };
      }
    });

    return logs.reverse();
  }

  getLogFiles() {
    const files = fs.readdirSync(this.logDir);
    return files
      .filter(f => f.startsWith('app-') && (f.endsWith('.log') || f.endsWith('.log.gz')))
      .sort()
      .reverse();
  }

  cleanOldLogs(daysToKeep = 30) {
    const files = this.getLogFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    files.forEach(file => {
      const filePath = path.join(this.logDir, file);
      const stats = fs.statSync(filePath);
      if (stats.mtime < cutoffDate) {
        fs.unlinkSync(filePath);
        this.info(`Deleted old log file: ${file}`);
      }
    });
  }
}

module.exports = Logger;
