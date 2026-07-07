declare module "cloudflare:sockets" {
  export function connect(options: {
    hostname: string;
    port: number;
    secureTransport?: "on" | "off" | "starttls";
  }): {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close(): void;
  };
}
