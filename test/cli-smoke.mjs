import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['server.mjs', '--provider=cli'], {
  cwd: new URL('..', import.meta.url),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-3000); });

try {
  await waitForServer(child);
  const health = await fetch('http://127.0.0.1:8787/health').then((response) => response.json());
  if (!health.ok || health.provider !== 'cli') throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);

  const chatResponse = await fetch('http://127.0.0.1:8787/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Коротко представься посетителю магазина.' }],
      page: { title: 'LedProjector demo', url: 'http://127.0.0.1:8787/', language: 'ru', visibleText: 'Интернет-магазин проекторов' },
    }),
  });
  const result = await chatResponse.json();
  if (result.code === 'CLI_USAGE_LIMIT') {
    console.log(JSON.stringify({ health, blocked: result.code, message: result.error }, null, 2));
  } else if (!chatResponse.ok || !result.answer) {
    throw new Error(`Chat smoke failed: ${JSON.stringify(result)} ${stderr}`);
  } else {
    console.log(JSON.stringify({ health, answer: result.answer }, null, 2));
  }
} finally {
  child.kill();
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

async function waitForServer(serverProcess) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Server exited early: ${stderr}`);
    try {
      const response = await fetch('http://127.0.0.1:8787/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start: ${stderr}`);
}
