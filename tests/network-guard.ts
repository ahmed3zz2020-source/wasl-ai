// ============================================================
// WASL AI — حاجز الشبكة (للاختبار فقط)
// ------------------------------------------------------------
// الهدف: إثبات أن الشريحة الأولى لا تُجري أي اتصال خارجي.
// ⭐ أي محاولة اتصال تُستبدل بدالة ترمي استثناءً ⇒ الاختبار يفشل فوراً.
// ⭐ سجلّ المحاولات يبقى فارغاً ⇒ دليل على صفر اتصال.
// ⛔ هذا الملف للاختبار فقط — لا يدخل في حزمة الشريحة (src/).
// ============================================================

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export class NetworkAccessError extends Error {
  readonly attempted: string;
  constructor(attempted: string) {
    super(`محاولة اتصال خارجي ممنوعة داخل الشريحة: ${attempted}`);
    this.name = 'NetworkAccessError';
    this.attempted = attempted;
  }
}

export interface NetworkGuard {
  readonly installed: boolean;
  readonly blocked: string[];
}

export function installNetworkGuard(): NetworkGuard {
  const blocked: string[] = [];
  const deny = (name: string) => {
    return (...args: unknown[]): never => {
      blocked.push(`${name}(${args.length})`);
      throw new NetworkAccessError(name);
    };
  };

  Object.defineProperty(globalThis, 'fetch', {
    value: deny('fetch'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    value: deny('WebSocket'),
    configurable: true,
    writable: true,
  });

  http.request = deny('http.request') as never;
  http.get = deny('http.get') as never;
  https.request = deny('https.request') as never;
  https.get = deny('https.get') as never;
  net.connect = deny('net.connect') as never;
  net.createConnection = deny('net.createConnection') as never;
  tls.connect = deny('tls.connect') as never;
  dns.lookup = deny('dns.lookup') as never;
  dns.promises.lookup = deny('dns.promises.lookup') as never;

  return { installed: true, blocked };
}
