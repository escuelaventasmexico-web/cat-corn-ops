// ============================================================================
// Vercel Serverless Function: POST /api/qz-sign
// Signs QZ Tray WebSocket requests using RSA-SHA512.
//
// Environment variable required:
//   QZ_PRIVATE_KEY — The PEM private key contents.
//   When pasted into Vercel Dashboard, literal \n are stored as text.
//   This handler restores them to real newlines before signing.
//
// Request:  POST { "request": "<string to sign>" }
// Response: 200  { "signature": "<base64 RSA-SHA512 signature>" }
// ============================================================================

import crypto from 'node:crypto';

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
    console.error(TAG, '❌ Missing or invalid "request" field in body. Got:', typeof toSign);
    return res.status(400).json({ error: 'Missing "request" field in body' });
  }
  console.log(TAG, '📥 Signature request received (' + toSign.length + ' chars)');

  // ── 2. Read private key from env ─────────────────────────────────────────
  const rawKey = process.env.QZ_PRIVATE_KEY;
  if (!rawKey) {
    console.error(TAG, '❌ QZ_PRIVATE_KEY environment variable is NOT SET');
    return res.status(500).json({ error: 'Server misconfigured: missing QZ_PRIVATE_KEY' });
  }
  if (rawKey.trim().length === 0) {
    console.error(TAG, '❌ QZ_PRIVATE_KEY is set but EMPTY');
    return res.status(500).json({ error: 'Server misconfigured: QZ_PRIVATE_KEY is empty' });
  }

  // ── 3. Restore real newlines ─────────────────────────────────────────────
  // Vercel Dashboard stores pasted newlines as literal \n text.
  // crypto.createSign needs real newlines in the PEM format.
  const privateKeyPem = rawKey.replace(/\\n/g, '\n');

  const hasHeader = privateKeyPem.includes('-----BEGIN');
  const hasFooter = privateKeyPem.includes('-----END');
  console.log(TAG, '🔑 Private key loaded (' + privateKeyPem.length + ' chars)',
    '| has BEGIN:', hasHeader,
    '| has END:', hasFooter
  );
  if (!hasHeader || !hasFooter) {
    console.error(TAG, '❌ Private key PEM format looks invalid (missing BEGIN/END markers)');
    console.error(TAG, '   First 60 chars:', privateKeyPem.substring(0, 60));
    return res.status(500).json({ error: 'Server misconfigured: QZ_PRIVATE_KEY format invalid' });
  }

  // ── 4. Sign with RSA-SHA512 ──────────────────────────────────────────────
  try {
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(toSign);
    const signature = signer.sign(privateKeyPem, 'base64');

    console.log(TAG, '✅ Signature generated (' + signature.length + ' chars base64)');

    return res.status(200).json({ signature });
  } catch (err) {
    console.error(TAG, '❌ Signing FAILED:', err.message);
    console.error(TAG, '   Stack:', err.stack);
    return res.status(500).json({ error: 'Signing failed: ' + err.message });
  }
}
