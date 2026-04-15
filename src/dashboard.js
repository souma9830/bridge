const metrics = require('./metrics');
const os = require('os');

/**
 * Real-time CLI dashboard using ANSI escape codes.
 * No external dependencies.
 */

const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const MAGENTA = `${ESC}[35m`;
const WHITE = `${ESC}[37m`;
const BG_DARK = `${ESC}[48;5;236m`;

let intervalHandle = null;
let activeStreams = new Map();
let dlqStats = { pending: 0, exhausted: 0 };

function setActiveStreams(streams) {
  activeStreams = streams;
}

function setDLQStats(pending, exhausted) {
  dlqStats = { pending, exhausted };
}

function box(title, lines, width = 60) {
  const top = `╔${'═'.repeat(width - 2)}╗`;
  const bot = `╚${'═'.repeat(width - 2)}╝`;
  const titleLine = `║ ${BOLD}${CYAN}${title.padEnd(width - 4)}${RESET} ║`;
  const sep = `╟${'─'.repeat(width - 2)}╢`;
  const body = lines.map((l) => {
    const clean = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - 4 - clean.length);
    return `║ ${l}${' '.repeat(pad)} ║`;
  });
  return [top, titleLine, sep, ...body, bot].join('\n');
}

function render() {
  const snap = metrics.getSnapshot();
  const mem = process.memoryUsage();
  const network = process.env.STELLAR_NETWORK || 'TESTNET';

  const lines = [];

  // ── Header ──
  lines.push('');
  lines.push(`  ${BOLD}${MAGENTA}★ ${WHITE}STELLAR-TO-WEB2 HOOK${RESET}  ${DIM}v1.0.0${RESET}`);
  lines.push(`  ${DIM}${'─'.repeat(50)}${RESET}`);
  lines.push('');

  // ── System info ──
  const sysLines = [
    `${DIM}Uptime${RESET}      ${GREEN}${metrics.getUptime()}${RESET}`,
    `${DIM}Network${RESET}     ${network === 'PUBLIC' ? `${RED}${BOLD}MAINNET${RESET}` : `${YELLOW}TESTNET${RESET}`}`,
    `${DIM}Memory${RESET}      ${CYAN}${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB${RESET} / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
    `${DIM}Platform${RESET}    ${os.platform()} ${os.arch()}`,
  ];
  lines.push(box('SYSTEM', sysLines));
  lines.push('');

  // ── Counters ──
  const counterLines = [
    `${DIM}Ops received${RESET}   ${BOLD}${snap.global.operationsReceived}${RESET}`,
    `${DIM}Ops matched${RESET}    ${BOLD}${GREEN}${snap.global.operationsMatched}${RESET}`,
    `${DIM}Webhooks OK${RESET}    ${BOLD}${GREEN}${snap.global.webhooksDispatched}${RESET}`,
    `${DIM}Webhooks fail${RESET}  ${BOLD}${snap.global.webhooksFailed > 0 ? RED : GREEN}${snap.global.webhooksFailed}${RESET}`,
  ];
  lines.push(box('METRICS', counterLines));
  lines.push('');

  // ── Streams ──
  const streamLines = [];
  if (activeStreams.size === 0) {
    streamLines.push(`${DIM}No active streams${RESET}`);
  } else {
    for (const [addr] of activeStreams) {
      const short = `${addr.substring(0, 8)}…${addr.substring(addr.length - 6)}`;
      streamLines.push(`${GREEN}●${RESET} ${short}`);
    }
  }
  lines.push(box('STREAMS', streamLines));
  lines.push('');

  // ── DLQ ──
  const dlqLines = [
    `${DIM}Pending${RESET}      ${dlqStats.pending > 0 ? `${YELLOW}${BOLD}${dlqStats.pending}${RESET}` : `${GREEN}0${RESET}`}`,
    `${DIM}Exhausted${RESET}    ${dlqStats.exhausted > 0 ? `${RED}${BOLD}${dlqStats.exhausted}${RESET}` : `${GREEN}0${RESET}`}`,
  ];
  lines.push(box('DEAD LETTER QUEUE', dlqLines));
  lines.push('');

  lines.push(`  ${DIM}Press Ctrl+C to exit${RESET}`);
  lines.push('');

  process.stdout.write(CLEAR + lines.join('\n'));
}

/**
 * Start the dashboard, refreshing every `intervalMs`.
 */
function startDashboard(intervalMs = 2000) {
  render();
  intervalHandle = setInterval(render, intervalMs);
}

function stopDashboard() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startDashboard, stopDashboard, setActiveStreams, setDLQStats };
