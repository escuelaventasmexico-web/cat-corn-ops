/**
 * QZ Tray Service — manages WebSocket connection to QZ Tray and
 * provides helpers to discover printers and send raw ESC/POS data.
 *
 * QZ Tray must be installed and running on the local machine.
 * Download: https://qz.io/download/
 *
 * ── Security (Trusted Mode) ────────────────────────────────────────
 * QZ Tray uses a certificate + signature model to identify websites.
 *
 * Certificate: fetched from /qz/digital-certificate.txt (static file)
 * Signature:   POST /api/qz-sign → Vercel serverless function that
 *              signs with the private key via RSA-SHA512
 * Algorithm:   SHA512 (set via qz.security.setSignatureAlgorithm)
 *
 * This eliminates: "Anonymous request", "Signature Missing",
 * "Invalid Signature", and "Untrusted website" dialogs.
 *
 * Setup:
 *   1. Place your QZ digital-certificate.txt in public/qz/
 *   2. Add QZ_PRIVATE_KEY env var in Vercel (contents of private-key.pem)
 *   3. Deploy — QZ Tray will auto-allow requests from your domain.
 */
import qz from 'qz-tray';

// ─── Constants ───────────────────────────────────────────────────────

const TAG = '[QZ Tray]';
const PRINTER_KEY = 'catcorn_thermal_printer';

/** Path where the QZ Tray certificate is served (Vite public/ → root) */
const CERT_PATH = '/qz/digital-certificate.txt';

/** Endpoint for the Vercel serverless signing function */
const SIGN_ENDPOINT = '/api/qz-sign';

// ─── Connection state ────────────────────────────────────────────────

let connectionPromise: Promise<void> | null = null;
let securityConfigured = false;

// ─── Security setup ──────────────────────────────────────────────────

/**
 * Configure QZ Tray security ONCE before the first connection.
 *
 * 1. Certificate: fetched from /qz/digital-certificate.txt
 * 2. Algorithm:   SHA512
 * 3. Signature:   POST /api/qz-sign → Vercel serverless function
 *
 * This provides full trusted mode — no "Anonymous request",
 * no "Signature Missing", no "Untrusted website" dialogs.
 */
function configureSecurity(): void {
  if (securityConfigured) return;
  securityConfigured = true;

  console.info(TAG, '🔐 Inicializando QZ Tray en modo TRUSTED');
  console.info(TAG, `   Certificado: ${CERT_PATH}`);
  console.info(TAG, `   Firma:       POST ${SIGN_ENDPOINT}`);
  console.info(TAG, '   Algoritmo:   SHA512');

  // ── 1. Certificate: fetch from static file ──────────────────────
  qz.security.setCertificatePromise((
    resolve: (cert: string) => void,
    reject: (err: Error) => void,
  ) => {
    console.info(TAG, '📄 Cargando certificado desde', CERT_PATH, '...');
    fetch(CERT_PATH)
      .then((r) => {
        if (!r.ok) throw new Error(`Certificate fetch failed: ${r.status} ${r.statusText}`);
        return r.text();
      })
      .then((cert) => {
        console.info(TAG, '✅ Certificate loaded (' + cert.length + ' bytes)');
        resolve(cert);
      })
      .catch((err) => {
        console.error(TAG, '❌ ERROR cargando certificado:', err);
        reject(err);
      });
  });

  // ── 2. Signature algorithm ──────────────────────────────────────
  qz.security.setSignatureAlgorithm('SHA512');
  console.info(TAG, '🔑 Signature algorithm set: SHA512');

  // ── 3. Signature: call Vercel serverless function ───────────────
  qz.security.setSignaturePromise((toSign: string) => {
    return (
      resolve: (sig: string) => void,
      reject?: (err: Error) => void,
    ) => {
      console.info(TAG, '🔑 Signature request received (' + toSign.length + ' chars), calling', SIGN_ENDPOINT, '...');
      fetch(SIGN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: toSign }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Sign endpoint ${r.status} ${r.statusText}`);
          return r.json();
        })
        .then((json: { signature: string }) => {
          console.info(TAG, '✅ Signature generated (' + json.signature.length + ' chars base64)');
          resolve(json.signature);
        })
        .catch((err) => {
          console.error(TAG, '❌ ERROR al firmar:', err);
          reject?.(err);
        });
    };
  });

  console.info(TAG, '✅ QZ Tray trusted mode initialized');
}

// ─── Public helpers ──────────────────────────────────────────────────

/**
 * Connect to QZ Tray (idempotent — reuses existing connection).
 * Throws if QZ Tray is not running.
 */
export async function connectQZ(): Promise<void> {
  if (qz.websocket.isActive()) return;

  if (!connectionPromise) {
    // Configure security callbacks before first connect
    configureSecurity();

    console.info(TAG, '🔌 Conectando a QZ Tray...');
    connectionPromise = qz.websocket
      .connect({ retries: 2, delay: 1 })
      .then(() => {
        console.info(TAG, '✅ Conectado a QZ Tray v' + (qz.api?.getVersion?.() ?? '?'));
      })
      .catch((err: Error) => {
        connectionPromise = null;
        // Classify the error for clear console output
        const msg = String(err?.message ?? err).toLowerCase();
        if (msg.includes('sign')) {
          console.error(TAG, '❌ ERROR DE FIRMA:', err);
          console.error(TAG, 'Verifica que QZ_PRIVATE_KEY esté configurada en Vercel y que /api/qz-sign responda.');
        } else if (msg.includes('cert')) {
          console.error(TAG, '❌ ERROR DE CERTIFICADO:', err);
          console.error(TAG, 'Verifica que /qz/digital-certificate.txt exista y contenga el PEM válido.');
        } else if (msg.includes('untrusted') || msg.includes('denied') || msg.includes('block')) {
          console.error(TAG, '❌ SOLICITUD DENEGADA por QZ Tray:', err);
          console.error(TAG, 'QZ Tray rechazó la conexión. Revisa que el certificado y la firma sean correctos.');
        } else {
          console.error(
            TAG,
            '❌ ERROR DE CONEXIÓN:',
            err,
            '\n¿Está QZ Tray instalado y corriendo? → https://qz.io/download/',
          );
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
