import { decryptSecret, encryptSecret } from "./email-crypto.js";
import { getMetaValue, setMetaValue } from "./email-meta.js";

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_address: string;
  configured: boolean;
  has_password: boolean;
};

export type SmtpEmailEnv = {
  SESSION_SECRET?: string;
  ADMIN_PASSWORD?: string;
};

export async function getSmtpSettings(env: SmtpEmailEnv): Promise<SmtpSettings> {
  const host = (await getMetaValue("smtp_host")).trim();
  const portRaw = (await getMetaValue("smtp_port")).trim();
  const port = portRaw ? Number(portRaw) : 587;
  const secure = (await getMetaValue("smtp_secure")) === "1";
  const username = (await getMetaValue("smtp_username")).trim();
  const fromAddress = (await getMetaValue("smtp_from_address")).trim();
  const hasPassword = Boolean((await getMetaValue("smtp_password_enc")).trim());

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    username,
    from_address: fromAddress,
    configured: Boolean(host && username && hasPassword && fromAddress),
    has_password: hasPassword,
  };
}

export async function saveSmtpSettings(
  env: SmtpEmailEnv,
  input: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password?: string;
    from_address: string;
  },
): Promise<{ error?: string; settings?: SmtpSettings }> {
  const host = input.host.trim();
  const username = input.username.trim();
  const fromAddress = input.from_address.trim().toLowerCase();
  const port = input.port;

  if (!host) return { error: "SMTP host is required" };
  if (!username) return { error: "SMTP username is required" };
  if (!fromAddress) return { error: "From address is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    return { error: "Enter a valid from email address" };
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return { error: "Enter a valid port (1–65535)" };
  }

  const existingPassword = (await getMetaValue("smtp_password_enc")).trim();
  if (!input.password?.trim() && !existingPassword) {
    return { error: "SMTP password is required" };
  }

  await setMetaValue("smtp_host", host);
  await setMetaValue("smtp_port", String(port));
  await setMetaValue("smtp_secure", input.secure ? "1" : "0");
  await setMetaValue("smtp_username", username);
  await setMetaValue("smtp_from_address", fromAddress);
  if (input.password?.trim()) {
    await setMetaValue("smtp_password_enc", await encryptSecret(input.password.trim(), env));
  }

  return { settings: await getSmtpSettings(env) };
}

export async function clearSmtpSettings(): Promise<void> {
  await setMetaValue("smtp_host", "");
  await setMetaValue("smtp_port", "");
  await setMetaValue("smtp_secure", "0");
  await setMetaValue("smtp_username", "");
  await setMetaValue("smtp_password_enc", "");
  await setMetaValue("smtp_from_address", "");
}

type SocketLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close?: () => void;
};

async function openSocket(host: string, port: number, secure: boolean): Promise<SocketLike> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const net = await import("node:net");
    const tls = await import("node:tls");
    return await new Promise((resolve, reject) => {
      const onSocket = (socket: import("node:net").Socket) => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let buffer = "";

        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            socket.on("data", (chunk: Buffer) => {
              buffer += decoder.decode(chunk, { stream: true });
              while (true) {
                const idx = buffer.indexOf("\r\n");
                if (idx < 0) break;
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                controller.enqueue(encoder.encode(line + "\r\n"));
              }
            });
            socket.on("end", () => controller.close());
            socket.on("error", (err) => controller.error(err));
          },
        });

        const writable = new WritableStream<Uint8Array>({
          write(chunk) {
            return new Promise<void>((res, rej) => {
              socket.write(chunk, (err) => (err ? rej(err) : res()));
            });
          },
        });

        resolve({
          readable,
          writable,
          close: () => socket.end(),
        });
      };

      if (secure) {
        const socket = tls.connect({ host, port, servername: host }, () => onSocket(socket));
        socket.on("error", reject);
      } else {
        const socket = net.connect({ host, port }, () => onSocket(socket));
        socket.on("error", reject);
      }
    });
  }

  const { connect } = await import("cloudflare:sockets");
  return connect({
    hostname: host,
    port,
    secureTransport: secure ? "on" : "off",
  }) as unknown as SocketLike;
}

async function readResponse(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\r\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

async function writeLine(writer: WritableStreamDefaultWriter<Uint8Array>, line: string): Promise<void> {
  await writer.write(new TextEncoder().encode(line + "\r\n"));
}

function expectCode(response: string, codes: number[]): void {
  const code = Number(response.slice(0, 3));
  if (!codes.includes(code)) {
    throw new Error(response.trim() || `SMTP error ${code}`);
  }
}

async function upgradeStartTls(
  socket: SocketLike,
  host: string,
): Promise<SocketLike> {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  await writeLine(writer, "STARTTLS");
  const response = await readResponse(reader);
  expectCode(response, [220]);
  await reader.releaseLock();
  await writer.releaseLock();
  socket.close?.();

  return openSocket(host, 587, true);
}

export async function sendViaSmtp(
  env: SmtpEmailEnv,
  to: string,
  fromName: string,
  replyTo: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ providerId?: string; error?: string }> {
  const settings = await getSmtpSettings(env);
  if (!settings.configured) {
    return { error: "SMTP is not fully configured" };
  }

  let password: string;
  try {
    password = await decryptSecret(await getMetaValue("smtp_password_enc"), env);
  } catch {
    return { error: "Could not decrypt SMTP password — re-enter it in Settings" };
  }

  const fromAddress = settings.from_address;
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

  const boundary = `bba_${crypto.randomUUID().replace(/-/g, "")}`;
  const messageLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    ...(replyTo.trim() ? [`Reply-To: ${replyTo.trim()}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  const messageBody = messageLines.join("\r\n");

  try {
    let socket = await openSocket(settings.host, settings.port, settings.secure);
    let reader = socket.readable.getReader();
    let writer = socket.writable.getWriter();

    expectCode(await readResponse(reader), [220]);
    await writeLine(writer, `EHLO beautybyappt.local`);
    let ehlo = await readResponse(reader);
    expectCode(ehlo, [250]);

    if (!settings.secure && settings.port === 587 && ehlo.toUpperCase().includes("STARTTLS")) {
      await reader.releaseLock();
      await writer.releaseLock();
      socket = await upgradeStartTls(socket, settings.host);
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      expectCode(await readResponse(reader), [220]);
      await writeLine(writer, `EHLO beautybyappt.local`);
      ehlo = await readResponse(reader);
      expectCode(ehlo, [250]);
    }

    const authUser = btoa(settings.username);
    const authPass = btoa(password);
    await writeLine(writer, "AUTH LOGIN");
    expectCode(await readResponse(reader), [334]);
    await writeLine(writer, authUser);
    expectCode(await readResponse(reader), [334]);
    await writeLine(writer, authPass);
    expectCode(await readResponse(reader), [235]);

    await writeLine(writer, `MAIL FROM:<${fromAddress}>`);
    expectCode(await readResponse(reader), [250]);
    await writeLine(writer, `RCPT TO:<${to}>`);
    expectCode(await readResponse(reader), [250, 251]);
    await writeLine(writer, "DATA");
    expectCode(await readResponse(reader), [354]);
    await writer.write(new TextEncoder().encode(messageBody + "\r\n.\r\n"));
    expectCode(await readResponse(reader), [250]);
    await writeLine(writer, "QUIT");
    await reader.releaseLock();
    await writer.releaseLock();
    socket.close?.();

    return { providerId: `smtp-${Date.now()}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "SMTP send failed" };
  }
}
