// Pure local technical authority. HTTP listening belongs to separately admitted control.
export type LocalRequest = Readonly<{ url: string; method: string; origin: string;
  authorization?: string; body?: unknown }>;
export function createLocalVerificationAuthority(options: Readonly<{
  origin: string; browserOrigin: string; randomBytes: (length: number) => Uint8Array;
  now?: () => number; ttlMs?: number;
}>) {
  const literal = (value: string) => /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.test(value)
    && new URL(value).origin === value && Number(new URL(value).port) <= 65535;
  if (!literal(options.origin) || !literal(options.browserOrigin)) throw Error('LOCAL_REALM_CONFIG');
  const now = options.now ?? Date.now, ttl = options.ttlMs ?? 600000;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 600000) throw Error('LOCAL_REALM_TTL');
  type Entry = { owner: { subjectId: string; profileId: string }; issued: number; until: number };
  const sessions = new Map<string, Entry>(), requests = new Set<string>();
  let stopped = false, lastTime = -Infinity;
  const hex = (n: number) => {
    const bytes = options.randomBytes(n);
    if (bytes.length !== n) throw Error('LOCAL_ENTROPY');
    return Array.from(bytes, x => x.toString(16).padStart(2,'0')).join('');
  };
  const token = () => {
    const b = options.randomBytes(32), alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (b.length !== 32) throw Error('LOCAL_ENTROPY');
    let out='', acc=0,bits=0;
    for(const v of b){acc=(acc<<8)|v;bits+=8;while(bits>=6){bits-=6;out+=alphabet[(acc>>>bits)&63];}}
    if(bits)out+=alphabet[(acc<<(6-bits))&63];
    return out;
  };
  const reply = (status: number, body?: unknown) => Object.freeze({ status, body });
  return Object.freeze({
    handle(request: LocalRequest) {
      if (stopped) return reply(503);
      let url: URL;
      try { url = new URL(request.url); } catch { return reply(400); }
      if (url.origin !== options.origin || url.username || url.password || url.search || url.hash
        || request.origin !== options.browserOrigin) return reply(403);
      const at=now();
      if (!Number.isFinite(at) || at<lastTime) { sessions.clear(); return reply(503); }
      lastTime=at;
      for(const [key,entry] of sessions)if(at>=entry.until)sessions.delete(key);
      if(request.method==='POST' && url.pathname==='/api/identity/local/session'){
        const body=request.body;
        if(!body || typeof body!=='object' || Object.keys(body).length!==1
          || !('request_id' in body) || typeof body.request_id!=='string'
          || !/^[a-f0-9]{32}$/u.test(body.request_id))return reply(400);
        if(requests.has(body.request_id))return reply(409);
        if(requests.size>=64 || sessions.size>=16)return reply(429);
        requests.add(body.request_id);
        const key=token();
        if(sessions.has(key))return reply(503);
        const entry={owner:{subjectId:'local_'+hex(16),profileId:'local_'+hex(16)},issued:at,until:at+ttl};
        sessions.set(key,entry);
        return reply(200,{token:key,owner:entry.owner,validUntil:new Date(entry.until).toISOString()});
      }
      if(!((request.method==='GET' && url.pathname==='/api/identity/session')
        || (request.method==='POST' && url.pathname==='/api/identity/session/logout')))return reply(404);
      const match=/^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.authorization??'');
      const entry=match && sessions.get(match[1]);
      if(!entry || at<entry.issued || at>=entry.until)return reply(401);
      if(request.method==='POST'){sessions.delete(match![1]);return reply(204);}
      return reply(200,{owner:entry.owner,validUntil:new Date(entry.until).toISOString()});
    },
    dispose(){stopped=true;sessions.clear();requests.clear();},
  });
}
