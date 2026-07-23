import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeKnowledgeEntries, previewKnowledgeUpsert, upsertKnowledgeEntry } from '../src/knowledge-workflow.mjs';

const baseEntry = {
  id: 'delivery-ukraine',
  title: 'Доставка по Україні та самовивіз в Одесі',
  keywords: ['доставка'],
  sourceUrl: 'https://ledprojector.com.ua/dostavka',
  reviewedAt: '2026-07-23',
  text: 'Текст',
};

test('knowledge merge adds a new entry', () => {
  const merged = mergeKnowledgeEntries([baseEntry], {
    id: 'returns-exchange',
    title: 'Повернення',
    keywords: ['повернення'],
    sourceUrl: 'https://ledprojector.com.ua/politika-obmena-i-vozvrata-tovara',
    reviewedAt: '2026-07-23',
    text: 'Правила повернення',
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, 'returns-exchange');
});

test('knowledge merge replaces an existing entry in upsert mode', () => {
  const merged = mergeKnowledgeEntries([baseEntry], {
    ...baseEntry,
    title: 'Нова доставка',
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Нова доставка');
});

test('knowledge merge rejects duplicate ids in add mode', () => {
  assert.throws(() => mergeKnowledgeEntries([baseEntry], baseEntry, 'add'), /already exists/);
});

test('knowledge upsert writes a backup and updates the file', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'ai-advisor-knowledge-'));
  const knowledgePath = join(workdir, 'store-faq.json');
  const initialEntries = [baseEntry];
  await writeFile(knowledgePath, `${JSON.stringify(initialEntries, null, 2)}\n`, 'utf8');

  const result = await upsertKnowledgeEntry(knowledgePath, {
    ...baseEntry,
    title: 'Новий заголовок',
  });

  const updated = JSON.parse(await readFile(knowledgePath, 'utf8'));
  assert.equal(result.count, 1);
  assert.match(result.backupPath, /\.bak-/);
  assert.equal(updated[0].title, 'Новий заголовок');
});

test('knowledge upsert preview is dry-run only', () => {
  const preview = previewKnowledgeUpsert([baseEntry], {
    ...baseEntry,
    title: 'Чернетка',
  });

  assert.equal(preview.action, 'replace');
  assert.equal(preview.beforeCount, 1);
  assert.equal(preview.afterCount, 1);
  assert.equal(preview.entry.title, 'Чернетка');
});
