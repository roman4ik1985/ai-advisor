import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export function buildCliArgs({ outputPath, model }) {
  const args = [
    'exec',
    '-',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--color', 'never',
    '--output-last-message', outputPath,
  ];
  if (model) args.push('--model', model);
  return args;
}

export async function askViaCli(prompt, config) {
  const tempDir = await mkdtemp(join(tmpdir(), 'ledprojector-ai-'));
  const outputPath = join(tempDir, 'answer.txt');

  try {
    await runCodex(prompt, buildCliArgs({ outputPath, model: config.codexModel }), config.codexTimeoutMs);
    const answer = (await readFile(outputPath, 'utf8')).trim();
    if (!answer) throw new Error('Codex CLI returned an empty answer.');
    return answer;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCodex(prompt, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
      shell: false,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Codex CLI response timed out.'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-3000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (/usage limit|hit your usage limit/i.test(stderr)) {
        const error = new Error('Лимит Codex CLI исчерпан. Повторите после сброса лимита или переключитесь на API.');
        error.code = 'CLI_USAGE_LIMIT';
        reject(error);
      } else if (/not logged in|login required|authentication/i.test(stderr)) {
        const error = new Error('Codex CLI не авторизован. Выполните codex login.');
        error.code = 'CLI_AUTH_REQUIRED';
        reject(error);
      } else {
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(prompt);
  });
}
