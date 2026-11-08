import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudyDocumentExporter } from '../server/study-document.mjs';
import { studyNote } from '../tests/fixtures/study-note.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/study-document'); await fs.mkdir(output, { recursive: true });
const exporter = createStudyDocumentExporter();
for (const format of ['pdf', 'docx']) {
  const bytes = await exporter.render(studyNote, format);
  await fs.writeFile(path.join(output, `linear-algebra.${format}`), bytes);
  console.log(JSON.stringify({ format, bytes: bytes.length }));
}
