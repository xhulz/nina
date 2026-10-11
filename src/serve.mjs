/**
 * What every page NINA serves on this machine shares: the loopback address, the check that refuses a request named
 * for another host, a port asked for and any free one when it is taken, and the system's opener for `--open`.
 *
 * The office (`nina pipeline --view`) came first and held all of it; the dashboard (`nina dashboard`) serves the
 * office too, and a second copy of the host check is the kind of fact this repository has shipped drifting before.
 */

import { spawn } from 'node:child_process';

/**
 * Whether a request names this machine for itself: a page elsewhere that rebinds its domain to the loopback address
 * reaches the port, and is refused. Any port, since a forwarded one — an editor's port forwarding, a container's —
 * reaches this one under another number.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export const fromHere = (req) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(req.headers.host ?? ''));

/**
 * Answers a request for another host with 403, and says whether it did.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} True when the request was refused.
 */
export function refuseElsewhere(req, res) {
  if (fromHere(req)) return false;
  res.writeHead(403, { 'content-type': 'text/plain' });
  res.end('not from here\n');
  return true;
}

/**
 * Listens on the loopback address: on `port`, or on any free one when it is taken. Port 0 asks for any from the start.
 *
 * @param {import('node:http').Server} server
 * @param {number} port
 * @returns {Promise<string>} The address served.
 */
export async function listenHere(server, port) {
  const listen = (p) =>
    new Promise((resolveListen, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolveListen();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    });
  try {
    await listen(port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || port === 0) throw error;
    await listen(0);
  }
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Hands an address to the system's opener. One that is not there fails at once, and one with no display to open on
 * exits with an error soon after; one still running after two seconds is taken to have opened it. Windows' explorer
 * answers 1 even when it opened the page.
 *
 * @param {string} url
 * @returns {Promise<boolean>} Whether the browser was opened.
 */
export function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolveOpen) => {
    let child;
    try {
      child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    } catch {
      resolveOpen(false);
      return;
    }
    const timer = setTimeout(() => resolveOpen(true), 2000);
    child.once('error', () => {
      clearTimeout(timer);
      resolveOpen(false);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveOpen(code === 0 || process.platform === 'win32');
    });
    child.unref();
  });
}

/**
 * A promise kept at Ctrl+C or a termination signal. Listening before the address is printed matters: pressed in
 * between, with no listener yet, Ctrl+C would kill the process outright instead of closing what it serves.
 *
 * @returns {Promise<void>}
 */
export function untilStopped() {
  return new Promise((resolveStop) => {
    process.once('SIGINT', resolveStop);
    process.once('SIGTERM', resolveStop);
  });
}
