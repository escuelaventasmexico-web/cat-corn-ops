// ============================================================================
// Vercel Serverless Function: POST /api/qz-sign
// Signs QZ Tray WebSocket requests using RSA-SHA512.
//
// Environment variable required:
//   QZ_PRIVATE_KEY — The PEM private key (with \n replaced by literal newlines)
//
// In Vercel Dashboard → Settings → Environment Variables:
//   Name:  QZ_PRIVATE_KEY
//   Value: (paste the entire contents of private-key.pem)
// ============================================================================

import crypto from 'node:crypto';

export default function handler(req, res) {
  // ── CORS (allow from any origin — QZ Tray sends from the page origin) ────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── Read the request body ────────────────────────────────────────────────
  const toSign = req.body?.request;
  if (!toSign || typeof toSign !== 'string') {
    console.error('[qz-sign] ❌ Missing or invalid "request" field in body');
    return res.status(400).json({ error: 'Missing "request" field in body' });
  }

  // ── Read the private key from env ────────────────────────────────────────
  const privateKeyPem = process.env.QZ_PRIVATE_KEY;
  if (!privateKeyPem) {
    console.error('[qz-sign] ❌ QZ_PRIVATE_KEY environment variable not set');
    return res.status(500).json({ error: 'Server misconfigured: missing QZ_PRIVATE_KEY' });
  }

  try {
    console.log('[qz-sign] 🔑 Signing request (' + toSign.length + ' chars)...');

    const signer = crypto.createSign('RSA-SHA512');
    signer.update(toSign);
    const signature = signer.sign(privateKeyPem, 'base64');

    console.log('[qz-sign] ✅ Signature generated (' + signature.length + ' chars base64)');

    return res.status(200).json({ signature });
  } catch (err) {
    console.error('[qz-sign] ❌ Signing failed:', err.message);
    return res.status(500).json({ error: 'Signing failed: ' + err.message });
  }
}
