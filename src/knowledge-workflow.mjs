import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { validateKnowledgeEntries } from './knowledge-validation.mjs';

export async function loadKnowledgeEntries(knowledgePath) {
  const raw = await readFile(knowledgePath, 'utf8');
  return validateKnowledgeEntries(JSON.parse(raw));
}

export function mergeKnowledgeEntries(entries, candidateEntry, mode = 'upsert') {
  const normalizedCandidate = validateKnowledgeEntries([candidateEntry])[0];
  const nextEntries = [...validateKnowledgeEntries(entries)];
  const index = nextEntries.findIndex((entry) => entry.id === normalizedCandidate.id);

  if (index >= 0) {
    if (mode === 'add') {
      throw new Error(`Knowledge entry id already exists: ${normalizedCandidate.id}.`);
    }
    nextEntries[index] = normalizedCandidate;
  } else {
    nextEntries.push(normalizedCandidate);
  }

  return validateKnowledgeEntries(nextEntries);
}

export function previewKnowledgeUpsert(entries, candidateEntry, mode = 'upsert') {
  const normalizedCandidate = validateKnowledgeEntries([candidateEntry])[0];
  const normalizedEntries = validateKnowledgeEntries(entries);
  const existingIndex = normalizedEntries.findIndex((entry) => entry.id === normalizedCandidate.id);
  const nextEntries = mergeKnowledgeEntries(normalizedEntries, normalizedCandidate, mode);

  return {
    action: existingIndex >= 0 ? (mode === 'add' ? 'reject' : 'replace') : 'add',
    beforeCount: normalizedEntries.length,
    afterCount: nextEntries.length,
    entry: normalizedCandidate,
    nextEntries,
  };
}

export async function saveKnowledgeEntries(knowledgePath, entries, { backup = true } = {}) {
  const normalized = validateKnowledgeEntries(entries);
  const tempPath = `${knowledgePath}.${process.pid}.tmp`;
  let backupPath = '';

  if (backup) {
    backupPath = join(dirname(knowledgePath), `${basename(knowledgePath)}.bak-${timestampId()}`);
    await copyFile(knowledgePath, backupPath);
  }

  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(tempPath, knowledgePath);

  return { backupPath };
}

export async function upsertKnowledgeEntry(knowledgePath, candidateEntry, { mode = 'upsert', backup = true } = {}) {
  const entries = await loadKnowledgeEntries(knowledgePath);
  const merged = mergeKnowledgeEntries(entries, candidateEntry, mode);
  const result = await saveKnowledgeEntries(knowledgePath, merged, { backup });

  return {
    count: merged.length,
    ...result,
  };
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}
