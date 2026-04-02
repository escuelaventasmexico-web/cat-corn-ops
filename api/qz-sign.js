// ============================================================================
// Vercel Serverless Function: POST /api/qz-sign
// Signs QZ Tray WebSocket requests using RSA-SHA512.
//
// Environment variable required:
//   QZ_PRIVATE_KEY — The PEM private key (paste full contents of private-key.pem)
//
// Request:  POST { "request": "<string to sign>" }
// Response: 200  { "signature": "<base64 RSA-SHA512 signature>" }
// ============================================================================

import crypto from 'crypto';

const TAG = '[qz-sign]';

export default function handler(req, res) {
  // ── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.error(TAG, '❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── 1. Read the "request" field from body ────────────────────────────────
  const toSign = req.body?.request;
  if (!toSign || typeof toSign !== 'string') {
    console.error(TAG, '❌ Missing or invalid "request" field. Got:', typeof toSign, '| body keys:', Object.keys(req.body || {}));
    return res.status(400).json({ error: 'Missing "request" field in body' });
  }
  console.log(TAG, '📥 Signature request received (' + toSign.length + ' chars)');

  // ── 2. Read private key from env ─────────────────────────────────────────
  const rawKey = process.env.QZ_PRIVATE_KEY;
  if (!rawKey) {
    console.error(TAG, '❌ QZ_PRIVATE_KEY env var is NOT SET');
    return res.status(500).json({ error: 'Server misconfigured: missing QZ_PRIVATE_KEY' });
  }
  if (rawKey.trim().length === 0) {
    console.error(TAG, '❌ QZ_PRIVATE_KEY is set but EMPTY');
    return res.status(500).json({ error: 'Server misconfigured: QZ_PRIVATE_KEY is empty' });
  }
  console.log(TAG, '🔑 Raw key from env: ' + rawKey.length + ' chars');

  // ── 3. Reconstruct PEM newlines ──────────────────────────────────────────
  // Vercel stores env vars differently depending on how they were set:
  //   - Dashboard paste:  real newlines may become literal \n (2 chars)
  //   - CLI / .env file:  real newlines may be preserved
  //   - JSON value:       may have \\n (escaped)
  // Strategy: try multiple replacements to cover all cases.
  let privateKeyPem = rawKey;
  // Replace literal 2-char sequence \n → real newline
  privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
  // Replace literal \r\n → real newline
  privateKeyPem = privateKeyPem.replace(/\\r\\n/g, '\n');
  // Trim whitespace
  privateKeyPem = privateKeyPem.trim();

  const hasHeader = privateKeyPem.includes('-----BEGIN');
  const hasFooter = privateKeyPem.includes('-----END');
  const lineCount = privateKeyPem.split('\n').length;
  console.log(TAG, '🔑 PEM after reconstruction:', privateKeyPem.length, 'chars |', lineCount, 'lines | BEGIN:', hasHeader, '| END:', hasFooter);

  if (!hasHeader || !hasFooter) {
    console.error(TAG, '❌ PEM format INVALID — missing BEGIN/END markers');
    console.error(TAG, '   First 80 chars:', JSON.stringify(privateKeyPem.substring(0, 80)));
    return res.status(500).json({ error: 'QZ_PRIVATE_KEY format invalid (no PEM markers)' });
  }
  if (lineCount < 3) {
    console.error(TAG, '⚠️ PEM has only', lineCount, 'lines — newlines may not have been reconstructed correctly');
    console.error(TAG, '   First 120 chars:', JSON.stringify(privateKeyPem.substring(0, 120)));
  }

  // ── 4. Sign with RSA-SHA512 ──────────────────────────────────────────────
  try {
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(toSign);
    const signature = signer.sign(privateKeyPem, 'base64');

    console.log(TAG, '✅ Signature generated (' + signature.length + ' chars base64)');
    return res.status(200).json({ signature });
  } catch (err) {
    console.error(TAG, '❌ crypto.createSign FAILED:', err.message);
    console.error(TAG, '   This usually means the PEM key format is corrupted.');
    console.error(TAG, '   PEM lines:', lineCount, '| first 80:', JSON.stringify(privateKeyPem.substring(0, 80)));
    return res.status(500).json({ error: 'Signing failed: ' + err.message });
  }
}
