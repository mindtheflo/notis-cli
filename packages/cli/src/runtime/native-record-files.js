import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { httpRequest } from './transport.js';
import { usageError } from './errors.js';

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MIME = { '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Reads a bounded local file, never interprets it and never attaches it to a row. */
export async function uploadNativeRecordFileWithCliRuntime({ runtime, target, recordKey, schemaRevision, requestId,
  filePath, name = basename(filePath || ''), contentType = MIME[extname(filePath || '').toLowerCase()] || 'application/octet-stream',
  signal, request = httpRequest }) {
  if (!UUID.test(recordKey || '') || !UUID.test(requestId || '') || !Number.isSafeInteger(schemaRevision) || schemaRevision < 0
    || !target || typeof target !== 'object' || Array.isArray(target) || !filePath) {
    throw usageError('Choose a local file, native target, record key, schema revision and stable request ID.');
  }
  const handle = await open(filePath, 'r');
  let data;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw usageError('Choose a regular file up to 8 MB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (!length || length > MAX_BYTES) throw usageError('Choose a file up to 8 MB.');
    data = buffer.subarray(0, length);
  } finally { await handle.close(); }
  const digest = createHash('sha256').update(data).digest('hex');
  const body = { protocol: 1, target, record_key: recordKey, schema_revision: schemaRevision, request_id: requestId,
    name, content_type: contentType, base64: data.toString('base64') };
  // No automatic retry: repeating this command with the same request ID is the
  // exact immutable intent; a mismatched request fails instead of overwriting.
  const result = (await request({ runtime, method: 'POST', path: '/portal_native_files/upload', spacesProtocol: 1, body, signal })).payload;
  if (result?.protocol !== 1 || result.record_key !== recordKey || result.request_id !== requestId
    || result.sha256 !== digest || result.size_bytes !== data.length || result.file?.name !== name
    || typeof result.file?.url !== 'string' || !/^https?:\/\//.test(result.file.url) || result.url !== result.file.url) {
    throw usageError('The file upload is not confirmed. Repeat the same request ID and file bytes.');
  }
  return result;
}
