import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const port = process.env.BACKEND_PORT || '8787';
const url = `http://127.0.0.1:${port}`;

const candidates = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  process.env.CLOUDFLARED_PATH,
].filter(Boolean);

const bin = candidates.find((p) => existsSync(p));

if (!bin) {
  console.error(
    'cloudflared not found. Install with: winget install Cloudflare.cloudflared\n' +
      'Or set CLOUDFLARED_PATH to the full path of cloudflared.exe',
  );
  process.exit(1);
}

const child = spawn(bin, ['tunnel', '--url', url], { stdio: 'inherit', shell: false });
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
