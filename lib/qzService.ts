/**
 * QZ Tray Service — manages WebSocket connection to QZ Tray and
 * provides helpers to discover printers and send raw ESC/POS data.
 *
 * QZ Tray must be installed and running on the local machine.
 * Download: https://qz.io/download/
 *
 * ── Security ────────────────────────────────────────────────────────
 * QZ Tray uses a certificate + signature model to identify websites.
 *
 * DEV  (default): Self-signed certificate embedded below.
 *       QZ Tray shows "Cat Corn OPS" as identity and asks for Allow
 *       ONCE — the user can tick "Remember this decision" and it sticks.
 *       Signature is empty (no signing server yet), so the request is
 *       "identified but unsigned". This is fine for localhost/dev.
 *
 * PROD: Set VITE_QZ_CERT_URL + VITE_QZ_SIGN_URL env vars.
 *       The app fetches the cert from a URL and sends signing requests
 *       to a backend that holds the private key. Fully trusted/auto-allowed.
 */
import qz from 'qz-tray';

// ─── Constants ───────────────────────────────────────────────────────

const TAG = '[QZ Tray]';
const PRINTER_KEY = 'catcorn_thermal_printer';

/**
 * Optional env vars for production signing.
 *   VITE_QZ_CERT_URL  → URL that returns the PEM certificate text
 *   VITE_QZ_SIGN_URL  → POST endpoint: { toSign } → { signature }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env: Record<string, string | undefined> = (import.meta as any).env ?? {};
const QZ_CERT_URL = _env.VITE_QZ_CERT_URL;
const QZ_SIGN_URL = _env.VITE_QZ_SIGN_URL;
const IS_PROD_SIGNING = !!(QZ_CERT_URL && QZ_SIGN_URL);

// ─── Self-signed certificate for development ────────────────────────
// Generated with:
//   openssl req -x509 -newkey rsa:2048 -keyout catcorn-qz.key \
//     -out catcorn-qz.crt -days 3650 -nodes \
//     -subj "/CN=Cat Corn OPS/O=Cat Corn/L=CDMX/C=MX"
//
// This cert identifies the app to QZ Tray so it can show "Cat Corn OPS"
// instead of "Anonymous request" and remember the user's Allow decision.
// The private key (certs/catcorn-qz.key) is NOT shipped to the browser.
// ─────────────────────────────────────────────────────────────────────
const DEV_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDCDCCAfACCQDI5RWP2ygeHzANBgkqhkiG9w0BAQsFADBGMRUwEwYDVQQDDAxD
YXQgQ29ybiBPUFMxETAPBgNVBAoMCENhdCBDb3JuMQ0wCwYDVQQHDARDRE1YMQsw
CQYDVQQGEwJNWDAeFw0yNjAzMzEyMTM4MzNaFw0zNjAzMjgyMTM4MzNaMEYxFTAT
BgNVBAMMDENhdCBDb3JuIE9QUzERMA8GA1UECgwIQ2F0IENvcm4xDTALBgNVBAcM
BENETVgxCzAJBgNVBAYTAk1YMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEA4y6hwH6XAQvSgXtcLl7W6uiTzA4IGqcJzykzmjhQIL1oz6wV8EOszMYxiAqX
ohtdz/2NfptPh6hO4Bu2dm81uOPYXliuzjVnA0llP7mWTMuHx95JJNHLOvX92fuE
JvoPdXQTdGfKVbVpwS028emrxGpoX2kvJmZ/Ais6y4Iup148U17YZPvHAFZHkXPr
KpvOTLFxv0LuSfQj6zKA/Qm/KAc0ZIl0qYZzEORzO0X6BA3dw9JgIuBau2nYHw8y
HMoMzLvJMUkAQ7eTFuogMwlCLd5Wj972nZfATzbAPMhJCj5Tj8w+pnCzzi30SXR5
h4gZz7Lg8Pkfh3d2KNr7vUraOwIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQA6OOuE
6zxFvooZPAh1xoNcKtwTk6iPfB+exNunKs6QksFQce1nLy/2YQZXjyl3nzBsFZx8
sS426m0AtKJGQeTIL5PYbhopkuakZG7pErvC8UUJ1dZ5quLT/rD+WC7yXUrUmsNv
tz/96zdfCKTetIKg1iVTSFT+YQ5WqU91SCUb14s6QeUDPZztZvkEFDdib8HQRbZN
g4AD7xDN2lfDC3lvl8dFwhMqeEBjRJBOKDx9wnhTlEbrRXKLVuqxmeL6f0pvibJm
ztw+6FE9sdgndxIky2LYScO9eUwbpt5/q3EBrLm58DCCmH4MY7ZSxh6h00KKfJA+
o+mugSws1QboMugZ
-----END CERTIFICATE-----`;

// ─── Connection state ────────────────────────────────────────────────

let connectionPromise: Promise<void> | null = null;
let securityConfigured = false;

// ─── Security setup ──────────────────────────────────────────────────

/**
 * Configure QZ Tray security ONCE before the first connection.
 *
 * DEV mode  → Self-signed cert (embedded above) + empty signature.
 *   QZ Tray shows "Cat Corn OPS" identity → user clicks Allow →
 *   "Remember this decision" WORKS (cert fingerprint is stored).
 *
 * PROD mode → Fetches cert from VITE_QZ_CERT_URL, signs requests
 *   via VITE_QZ_SIGN_URL. Fully trusted = auto-allowed.
 */
function configureSecurity(): void {
  if (securityConfigured) return;
  securityConfigured = true;

  if (IS_PROD_SIGNING) {
    // ── Production: real certificate + backend signing ──────────────
    console.info(TAG, '🔐 Modo PRODUCCIÓN — certificado + firma remota');
    console.info(TAG, `   CERT: ${QZ_CERT_URL}`);
    console.info(TAG, `   SIGN: ${QZ_SIGN_URL}`);

    qz.security.setCertificatePromise((
      resolve: (cert: string) => void,
      reject: (err: Error) => void,
    ) => {
      console.info(TAG, '📄 Solicitando certificado desde', QZ_CERT_URL);
      fetch(QZ_CERT_URL!)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Cert fetch ${r.status}`))))
        .then((cert) => {
          console.info(TAG, '✅ Certificado de producción cargado (' + cert.length + ' bytes)');
          resolve(cert);
        })
        .catch((err) => {
          console.error(TAG, '❌ ERROR CERTIFICADO producción:', err);
          reject(err);
        });
    });

    qz.security.setSignaturePromise((toSign: string) => {
      return (
        resolve: (sig: string) => void,
        reject?: (err: Error) => void,
      ) => {
        console.info(TAG, '🔑 Solicitando firma al servidor...');
        fetch(QZ_SIGN_URL!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toSign }),
        })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Sign fetch ${r.status}`))))
          .then((json: { signature: string }) => {
            console.info(TAG, '✅ Firma generada (' + json.signature.length + ' chars)');
            resolve(json.signature);
          })
          .catch((err) => {
            console.error(TAG, '❌ ERROR FIRMA producción:', err);
            reject?.(err);
          });
      };
    });
  } else {
    // ── Development: self-signed cert, no signature ─────────────────
    console.info(TAG, '🛠️ Modo DESARROLLO — certificado self-signed');
    console.info(TAG, '   Identidad: "Cat Corn OPS" (CN)');
    console.info(TAG, '   La primera vez QZ Tray pedirá Allow.');
    console.info(TAG, '   Marca "Remember this decision" → no vuelve a preguntar.');

    // ★ Certificate: provide the embedded self-signed cert.
    // This gives QZ Tray a fingerprint to identify this site,
    // so "Remember this decision" actually works.
    // Previously this was resolve('') → "Anonymous request" → can't remember.
    qz.security.setCertificatePromise((
      resolve: (cert: string) => void,
    ) => {
      console.info(TAG, '📄 Certificado: self-signed Cat Corn OPS (' + DEV_CERTIFICATE.length + ' bytes)');
      resolve(DEV_CERTIFICATE);
    });

    // ★ Signature: empty (no signing server in dev).
    // QZ Tray marks request as "identified but unsigned" which is
    // fine for dev — the user clicks Allow once and it remembers.
    qz.security.setSignaturePromise((_toSign: string) => {
      return (resolve: (sig: string) => void) => {
        console.debug(TAG, '🔑 Firma: omitida (modo desarrollo, sin servidor de firma)');
        resolve('');
      };
    });
  }
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
          console.error(TAG, 'Solución: verifica que el certificado sea válido y QZ Tray esté actualizado.');
        } else if (msg.includes('cert')) {
          console.error(TAG, '❌ ERROR DE CERTIFICADO:', err);
          console.error(TAG, 'El certificado embebido puede estar corrupto o expirado.');
        } else if (msg.includes('untrusted') || msg.includes('denied') || msg.includes('block')) {
          console.error(TAG, '❌ SOLICITUD DENEGADA por QZ Tray:', err);
          console.error(TAG, 'Solución: cuando QZ pregunte, marca "Remember" y click "Allow".');
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
