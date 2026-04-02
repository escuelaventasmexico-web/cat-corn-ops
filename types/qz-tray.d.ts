declare module 'qz-tray' {
  interface QZ {
    websocket: {
      connect(options?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
      isActive(): boolean;
    };
    printers: {
      find(query?: string): Promise<string | string[]>;
      getDefault(): Promise<string>;
    };
    configs: {
      create(printer: string | { host?: string; port?: number; file?: string }, options?: Record<string, unknown>): QZConfig;
      setDefaults(options: Record<string, unknown>): void;
    };
    print(config: QZConfig, data: QZPrintData[] | string[]): Promise<void>;
    security: {
      setCertificatePromise(
        callback: (
          resolve: (cert: string) => void,
          reject: (err: Error) => void,
        ) => void,
        options?: { rejectOnFailure?: boolean },
      ): void;
      setSignatureAlgorithm(algorithm: string): void;
      setSignaturePromise(
        callback: (
          toSign: string,
        ) => (
          resolve: (sig: string) => void,
          reject: (err: Error) => void,
        ) => void,
      ): void;
    };
    api: {
      setPromiseType(promiseConstructor: typeof Promise): void;
      setSha256Type(sha256: (data: string) => string): void;
      getVersion(): string;
    };
  }

  interface QZConfig {
    setPrinter(printer: string): void;
    getPrinter(): string;
    reconfigure(options: Record<string, unknown>): void;
  }

  type QZPrintData = string | {
    type?: 'raw' | 'pixel' | 'direct';
    format?: 'plain' | 'base64' | 'hex' | 'command' | 'image' | 'file' | 'xml';
    data: string;
    options?: Record<string, unknown>;
  };

  const qz: QZ;
  export default qz;
}
