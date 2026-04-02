/**
 * QZ Tray Service — manages WebSocket connection to QZ Tray and
 * provides helpers to discover printers and send raw ESC/POS data.
 *
 * QZ Tray must be installed and running on the local machine.
 * Download: https://qz.io/download/
 *
 * ── Security (Trusted Mode) ────────────────────────────────────────
 * Certificate: EMBEDDED inline (no fetch — avoids cache/deployment issues)
 * Algorithm:   SHA512
 * Signature:   POST /api/qz-sign → Vercel serverless function
 *
 * The certificate is the QZ Tray Demo Cert issued by QZ Industries, LLC.
 * It is embedded directly in code to guarantee it's always available —
 * previous approach (fetch from /qz/digital-certificate.txt) caused
 * persistent "Anonymous request" because Vercel served a cached placeholder.
 */
import qz from 'qz-tray';

// ─── Constants ───────────────────────────────────────────────────────

const TAG = '[QZ]';
const PRINTER_KEY = 'catcorn_thermal_printer';

/** Endpoint for the Vercel serverless signing function */
const SIGN_ENDPOINT = '/api/qz-sign';

/**
 * QZ Tray Demo Certificate — PEM embedded inline.
 * CN=QZ Tray Demo Cert, O=QZ Industries, LLC
 * Valid: 2026-03-30 → 2046-03-30
 * Fingerprint: baf42d2f6b4384b1c08d67fa53c156b98cfe1093
 */
const QZ_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'MIIECzCCAvOgAwIBAgIGAZ1F/W8MMA0GCSqGSIb3DQEBCwUAMIGiMQswCQYDVQQG',
  'EwJVUzELMAkGA1UECAwCTlkxEjAQBgNVBAcMCUNhbmFzdG90YTEbMBkGA1UECgwS',
  'UVogSW5kdXN0cmllcywgTExDMRswGQYDVQQLDBJRWiBJbmR1c3RyaWVzLCBMTEMx',
  'HDAaBgkqhkiG9w0BCQEWDXN1cHBvcnRAcXouaW8xGjAYBgNVBAMMEVFaIFRyYXkg',
  'RGVtbyBDZXJ0MB4XDTI2MDMzMDIyMjIxMFoXDTQ2MDMzMDIyMjIxMFowgaIxCzAJ',
  'BgNVBAYTAlVTMQswCQYDVQQIDAJOWTESMBAGA1UEBwwJQ2FuYXN0b3RhMRswGQYD',
  'VQQKDBJRWiBJbmR1c3RyaWVzLCBMTEMxGzAZBgNVBAsMElFaIEluZHVzdHJpZXMs',
  'IExMQzEcMBoGCSqGSIb3DQEJARYNc3VwcG9ydEBxei5pbzEaMBgGA1UEAwwRUVog',
  'VHJheSBEZW1vIENlcnQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDI',
  '/WAr/Ug3BtJTLia8XGesjtr2ZwmnjxiCAaOb39jEEwQF1jk/RRIB2A7mhBZui+x9',
  'gxcpKVBcyKkQDzaepZSPWtR+LNNtZ3VYc7EpDH1x70GGgUWn2wrZPcWRZeye28K0',
  'n0SEuxpcOIyL0G28DLIvM0p9p4+JTghabCw4Jmrn6cIcuKTiJxc049kljo29YTud',
  '0RFmNi7+Q/1usy4QWrfiXBqjGL7/gDNSsKQTlIOZnc3PC7f0U3a67Zup1tLeGnhp',
  'P/PRQmo4pYvCctscd5R7G1X6fo2bkpDmK8UCpS3wNfwEvdeSYcyvDIG8MFZGFe32',
  'MhbCzI3tXwQ66egm/t1FAgMBAAGjRTBDMBIGA1UdEwEB/wQIMAYBAf8CAQEwDgYD',
  'VR0PAQH/BAQDAgEGMB0GA1UdDgQWBBRKgUNuig9ltNsI1HucwO9lZVnKkjANBgkq',
  'hkiG9w0BAQsFAAOCAQEAbwzRg+Owx/4aCdzz7dP/M1BrruKJJBaOzUkgMPDxpP2Y',
  'vUEb3dLZ505yIqmyjzDYSBksRp9cKqgaQtVKj/zB5dZbMvJArEZX6gPsJdBE5nMZ',
  'Mbor/jf4ljdrNu4Cd+BDNPDbdT3P6Ildeku3EhrvvACmiCZ5i6sI7BpAA4xThJO3',
  'JAiaMhDRfBmn9m5SskEiJDf/jlq/HqJDvJ+FOD6T1aEvkzDvXC+qrg3RLADOItet',
  'm2Zp/PcwQfWOUGaKSKpu5oxwF++UK5oLrZn4vV7NPp7P/fDdavRJK693KTBjFHBJ',
  'DAxB3W790yjK6QTtwqgV19XTCBPF5bimw1SjPsDHtg==',
  '-----END CERTIFICATE-----',
].join('\n');

// ─── Connection state ────────────────────────────────────────────────

let connectionPromise: Promise<void> | null = null;
let securityConfigured = false;

// ─── Security setup ──────────────────────────────────────────────────

/**
 * Initialize QZ Tray security — MUST run before any connect/print/find.
 * Safe to call multiple times (idempotent).
 *
 * Sets up:
 *   1. setCertificatePromise  → resolves with EMBEDDED PEM (no fetch needed)
 *   2. setSignatureAlgorithm  → SHA512
 *   3. setSignaturePromise    → POST /api/qz-sign
 */
function initializeQzSecurity(): void {
  if (securityConfigured) return;
  securityConfigured = true;

  console.info(TAG, '🔐 initializeQzSecurity() — configuring certificate + signature');

  // ── 1. Certificate (INLINE — no fetch, no cache, no deployment issues) ──
  qz.security.setCertificatePromise(
    (resolve: (cert: string) => void, reject: (err: Error) => void) => {
      console.info(TAG, '📄 certificate callback invoked');
      console.info(TAG, '📄 certificate: EMBEDDED inline,', QZ_CERTIFICATE.length, 'chars');
      console.info(TAG, '📄 starts with:', JSON.stringify(QZ_CERTIFICATE.substring(0, 30)));

      if (!QZ_CERTIFICATE.includes('-----BEGIN CERTIFICATE-----')) {
        const err = new Error('Embedded certificate is invalid (no PEM header)');
        console.error(TAG, '❌', err.message);
        reject(err);
        return;
      }

      console.info(TAG, '✅ certificate resolving to QZ Tray');
      resolve(QZ_CERTIFICATE);
    },
    // ★ rejectOnFailure: true → if cert fails, CONNECTION fails (not silent anonymous)
    { rejectOnFailure: true },
  );

  // ── 2. Signature algorithm ──────────────────────────────────────
  qz.security.setSignatureAlgorithm('SHA512');
  console.info(TAG, '🔑 signature algorithm: SHA512');

  // ── 3. Signature ────────────────────────────────────────────────
  qz.security.setSignaturePromise((toSign: string) => {
    return (
      resolve: (sig: string) => void,
      reject: (err: Error) => void,
    ) => {
      console.info(TAG, '🔑 signature requested (' + toSign.length + ' chars)');

      fetch(SIGN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: toSign }),
      })
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.text().catch(() => '(no body)');
            throw new Error(`Sign endpoint ${r.status}: ${body}`);
          }
          return r.json();
        })
        .then((json: { signature?: string }) => {
          if (!json.signature || typeof json.signature !== 'string') {
            throw new Error('Response missing "signature". Keys: ' + Object.keys(json).join(', '));
          }
          console.info(TAG, '✅ signature received (' + json.signature.length + ' chars)');
          resolve(json.signature);
        })
        .catch((err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(TAG, '❌ signature FAILED:', error.message);
          reject(error);
        });
    };
  });

  console.info(TAG, '✅ QZ security initialized (cert + SHA512 + sign)');
}

// ★ Call at MODULE LOAD TIME — registers callbacks immediately.
// The actual fetch/sign only happen when QZ Tray asks (during connect).
initializeQzSecurity();

// ─── Public helpers ──────────────────────────────────────────────────

/**
 * Connect to QZ Tray (idempotent — reuses existing connection).
 * Throws if QZ Tray is not running or if certificate/signature fails.
 */
export async function connectQZ(): Promise<void> {
  if (qz.websocket.isActive()) {
    console.debug(TAG, '🔌 already connected');
    return;
  }

  if (!connectionPromise) {
    // Belt & suspenders: ensure security is configured even if module init was skipped
    initializeQzSecurity();

    console.info(TAG, '🔌 connecting with certificate + signature initialized...');
    connectionPromise = qz.websocket
      .connect({ retries: 2, delay: 1 })
      .then(() => {
        console.info(TAG, '✅ connected to QZ Tray v' + (qz.api?.getVersion?.() ?? '?'));
      })
      .catch((err: Error) => {
        connectionPromise = null;
        const msg = String(err?.message ?? err).toLowerCase();
        if (msg.includes('certificate') || msg.includes('cert')) {
          console.error(TAG, '❌ CERTIFICATE ERROR:', err);
          console.error(TAG, '   El certificado PEM está embebido en qzService.ts — verificar que sea válido.');
        } else if (msg.includes('sign')) {
          console.error(TAG, '❌ SIGNATURE ERROR:', err);
          console.error(TAG, '   Verifica que QZ_PRIVATE_KEY esté configurada en Vercel.');
        } else if (msg.includes('untrusted') || msg.includes('denied') || msg.includes('block')) {
          console.error(TAG, '❌ DENIED by QZ Tray:', err);
        } else {
          console.error(TAG, '❌ CONNECTION ERROR:', err);
          console.error(TAG, '   ¿Está QZ Tray instalado y corriendo? → https://qz.io/download/');
        }
        throw err;
      });
  }
  return connectionPromise;
}

/**
 * Disconnect from QZ Tray (safe to call if not connected).
 */
export async function disconnectQZ(): Promise<void> {
  if (qz.websocket.isActive()) {
    await qz.websocket.disconnect();
    console.info(TAG, '🔌 Desconectado');
  }
  connectionPromise = null;
}

/**
 * Whether a QZ Tray connection is currently active.
 */
export function isQZConnected(): boolean {
  return qz.websocket.isActive();
}

/**
 * List all printers visible to QZ Tray.
 */
export async function listPrinters(): Promise<string[]> {
  console.info(TAG, '🖨️ Buscando impresoras...');
  try {
    await connectQZ();
    const result = await qz.printers.find();
    const printers = Array.isArray(result) ? result : [result];
    console.info(TAG, `✅ ${printers.length} impresora(s) encontrada(s):`, printers);
    return printers;
  } catch (err) {
    console.error(TAG, '❌ ERROR AL BUSCAR IMPRESORAS:', err);
    throw err;
  }
}

/**
 * Send raw ESC/POS data to a named thermal printer.
 *
 * Key decisions for macOS compatibility:
 *  - Config uses `encoding: 'ISO-8859-1'` so byte values 0x00-0xFF pass through.
 *  - Config uses `spool: { size: 1 }` to avoid CUPS PostScript conversion.
 *  - Data is sent as a plain `string[]` — QZ Tray treats this as raw type
 *    automatically, bypassing any pixel/html/pdf rendering pipeline.
 */
export async function printRaw(
  printerName: string,
  data: string[],
): Promise<void> {
  console.info(TAG, `🖨️ Enviando RAW a "${printerName}"...`);
  try {
    await connectQZ();

    const configOpts = {
      encoding: 'ISO-8859-1',
      spool: { size: 1 },
    };
    const config = qz.configs.create(printerName, configOpts);

    console.info(TAG, '⚙️ Config:', JSON.stringify({ printer: printerName, ...configOpts }));
    console.info(TAG, `📦 Data: ${data.length} fragmentos, tipo: string[] (RAW directo)`);
    console.debug(TAG, '📤 Primeros 5 fragmentos:', data.slice(0, 5).map(s =>
      s.split('').map(c => {
        const code = c.charCodeAt(0);
        return code < 0x20 || code > 0x7E ? `\\x${code.toString(16).padStart(2, '0')}` : c;
      }).join('')
    ));

    // ★ Plain string array = QZ Tray sends as raw bytes, no CUPS conversion
    await qz.print(config, data);
    console.info(TAG, '✅ Impresión RAW enviada correctamente');
  } catch (err) {
    console.error(TAG, `❌ ERROR AL IMPRIMIR en "${printerName}":`, err);
    throw err;
  }
}

// ─── Diagnostic test print ──────────────────────────────────────────

/**
 * Resultado de la prueba de impresión.
 */
export interface TestPrintResult {
  label: string;
  success: boolean;
  error?: string;
}

/**
 * Prueba de impresión RAW mínima para diagnóstico.
 *
 * Envía ESC/POS puro como string[] (el formato que bypasea CUPS).
 * Usa la misma config `encoding + spool` que printRaw.
 *
 * Orden de bytes:
 *   \x1B\x40          → init
 *   texto + \n         → líneas de texto
 *   \x1D\x56\x00      → full cut (GS V 0)
 */
export async function printTestRawReceipt(
  printerName: string,
): Promise<TestPrintResult[]> {
  const results: TestPrintResult[] = [];
  const now = new Date();
  const ts = now.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  console.info(TAG, '═══════════════════════════════════════');
  console.info(TAG, '🧪 PRUEBA RAW ESC/POS — DIAGNÓSTICO');
  console.info(TAG, `   Impresora: "${printerName}"`);
  console.info(TAG, `   Hora:      ${ts}`);
  console.info(TAG, `   Config:    encoding=ISO-8859-1, spool.size=1`);
  console.info(TAG, `   Formato:   string[] (RAW directo, sin objetos)`);
  console.info(TAG, '═══════════════════════════════════════');

  try {
    await connectQZ();
  } catch (err: any) {
    console.error(TAG, '❌ No se pudo conectar a QZ Tray:', err);
    results.push({ label: 'Conexión QZ Tray', success: false, error: err?.message ?? String(err) });
    return results;
  }

  // ─── ESC/POS data as plain string array ──────────────────────────
  const data: string[] = [
    '\x1B\x40',                        // ESC @ — initialize printer
    '\x1B\x61\x01',                    // ESC a 1 — center align
    '\x1B\x45\x01',                    // ESC E 1 — bold on
    'CAT CORN\n',                      // text
    '\x1B\x45\x00',                    // ESC E 0 — bold off
    'PRUEBA DE IMPRESION\n',
    'RAW ESC/POS\n',
    '\x1B\x61\x00',                    // ESC a 0 — left align
    '--------------------------------\n',
    `Fecha: ${ts}\n`,
    `Impresora: ${printerName}\n`,
    '--------------------------------\n',
    'Si ves este ticket, la\n',
    'impresion RAW funciona!\n',
    '--------------------------------\n',
    '\n\n\n\n',                        // feed
    '\x1D\x56\x00',                    // GS V 0 — full cut
  ];

  console.info(TAG, '📤 Datos a enviar (string[]):');
  data.forEach((frag, i) => {
    const hex = frag.split('').map(c => {
      const code = c.charCodeAt(0);
      return code < 0x20 || code > 0x7E
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : c;
    }).join('');
    console.info(TAG, `   [${i}] ${hex}`);
  });

  // ── Enviar ──
  const label = 'ESC/POS RAW string[] + encoding ISO-8859-1';
  try {
    const configOpts = {
      encoding: 'ISO-8859-1',
      spool: { size: 1 },
    };
    const config = qz.configs.create(printerName, configOpts);
    console.info(TAG, '⚙️ Config:', JSON.stringify({ printer: printerName, ...configOpts }));
    console.info(TAG, '🖨️ Llamando qz.print()...');

    await qz.print(config, data);

    console.info(TAG, '✅ qz.print() resolvió OK — datos enviados a la impresora');
    results.push({ label, success: true });
  } catch (err: any) {
    console.error(TAG, '❌ qz.print() FALLÓ:', err);
    results.push({ label, success: false, error: err?.message ?? String(err) });
  }

  // ── Resumen ──
  console.info(TAG, '\n═══════════════════════════════════════');
  console.info(TAG, '🧪 RESULTADO:');
  results.forEach((r) => {
    console.info(TAG, `   ${r.success ? '✅' : '❌'} ${r.label}${r.error ? ' → ' + r.error : ''}`);
  });
  if (results.every(r => r.success)) {
    console.info(TAG, '\n💡 Si dice OK pero no imprime físicamente:');
    console.info(TAG, '   1. Abre "Cola de impresión" en macOS y revisa si hay trabajos en pausa');
    console.info(TAG, '   2. Si dice "Held" o "Paused" → click derecho → Resume');
    console.info(TAG, '   3. Elimina la impresora de macOS y vuelve a agregarla como "Generic"');
    console.info(TAG, '   4. Asegúrate de que NO tenga driver PostScript/PCL asignado');
    console.info(TAG, '   5. El driver debe ser "Generic / Text Only" o sin driver');
  }
  console.info(TAG, '═══════════════════════════════════════');

  return results;
}

// ─── Printer selection persistence ──────────────────────────────────

export function savePrinterName(name: string): void {
  try {
    localStorage.setItem(PRINTER_KEY, name);
  } catch { /* quota / private mode — ignore */ }
}

export function getSavedPrinterName(): string | null {
  try {
    return localStorage.getItem(PRINTER_KEY);
  } catch {
    return null;
  }
}
