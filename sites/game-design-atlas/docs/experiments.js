const storageKey = 'game-design-atlas:experiments:v1';
const memory = new Map();
const maxReadings = 8;

function cleanText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 36).flatMap((row) => {
    if (!row || typeof row.label !== 'string') return [];
    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : cleanText(row.value, 800);
    return [{ label: cleanText(row.label, 100), value }];
  });
}

export function cleanReading(raw) {
  const results = cleanRows(raw?.results);
  const parameters = cleanRows(raw?.parameters);
  return results.length && parameters.length ? { parameters, results } : null;
}

function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-z0-9-]{8,70}$/iu.test(raw.id)
    || !Number.isInteger(raw.week) || raw.week < 1 || raw.week > 28 || typeof raw.lab !== 'string' || !/^[a-z0-9-]{1,36}$/u.test(raw.lab)) return null;
  const prediction = cleanText(raw.prediction, 2000);
  if (!prediction.trim()) return null;
  const readings = Array.isArray(raw.readings) ? raw.readings.slice(0, maxReadings).map(cleanReading).filter(Boolean) : [];
  const latest = cleanReading(raw.latest);
  const reflection = cleanText(raw.reflection, 3000);
  return {
    id: raw.id, week: raw.week, lab: raw.lab, prediction,
    createdAt: cleanText(raw.createdAt, 35),
    latest,
    readings, reflection,
    complete: raw.complete === true && canArchiveExperiment({ readings, latest, reflection })
  };
}

export function readExperiments() {
  const byId = new Map();
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(value)) for (const item of value) {
      const record = cleanRecord(item);
      if (record) byId.set(record.id, record);
    }
  } catch { /* An unsaved session is still available for export. */ }
  for (const [id, record] of memory) byId.set(id, record);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveExperiment(record) {
  const cleaned = cleanRecord(record);
  if (!cleaned) return false;
  memory.set(cleaned.id, cleaned);
  try {
    localStorage.setItem(storageKey, JSON.stringify(readExperiments()));
    memory.clear();
    return true;
  } catch { return false; }
}

export function importExperiments(raw) {
  if (!Array.isArray(raw)) return { added: 0, saved: true };
  const existing = new Map(readExperiments().map((record) => [record.id, record]));
  let added = 0;
  let saved = true;
  for (const value of raw) {
    const record = cleanRecord(value);
    if (!record) continue;
    const local = existing.get(record.id);
    if (local && (local.complete || !record.complete || local.week !== record.week || local.lab !== record.lab || local.prediction !== record.prediction)) continue;
    existing.set(record.id, record);
    memory.set(record.id, record);
    added++;
  }
  if (added) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(readExperiments()));
      memory.clear();
    } catch { saved = false; }
  }
  return { added, saved };
}

export function makeExperiment(week, lab, prediction) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
    week, lab, prediction: prediction.trim(), createdAt: new Date().toISOString(),
    latest: null, readings: [], reflection: '', complete: false
  };
}

export function appendReading(record, raw) {
  const reading = cleanReading(raw);
  if (!reading || record.complete || record.readings.length >= maxReadings || JSON.stringify(record.readings.at(-1)) === JSON.stringify(reading)) return record;
  return { ...record, latest: reading, readings: [...record.readings, reading] };
}

export function canArchiveExperiment(record) {
  return Boolean((record?.readings.length || record?.latest) && record.reflection.replace(/\s/gu, '').length >= 8 && /[\p{L}\p{N}]/u.test(record.reflection));
}

export function archiveReadings(record) {
  const latest = cleanReading(record.latest);
  if (!latest || JSON.stringify(record.readings.at(-1)) === JSON.stringify(latest)) return record.readings;
  return [...record.readings, latest];
}
