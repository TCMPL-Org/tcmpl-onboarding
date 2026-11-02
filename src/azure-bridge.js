// Azure bridge: gives the app the same `claude.use(...)` interface it was built
// with, backed by this site's own Azure Functions API (/api/...).
//   claude.use('db')     -> shared saving in Cosmos DB  (/api/data/...)
//   claude.use('sample') -> AI replies via Azure OpenAI (/api/ai)
// Anything the backend has not switched on is reported as unavailable, and the
// app falls back to session-only saving and scripted replies on its own.

const POLL_MS = 15000;
const FX_POLL_MS = 300000;

let healthP = null;
function health() {
  if (!healthP) {
    healthP = fetch('/api/health', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(h => ({ db: Boolean(h && h.db), ai: Boolean(h && h.ai) }));
  }
  return healthP;
}

function codedError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw codedError('network', 'Network error');
  }
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (res.status === 401 || res.status === 403) throw codedError('permission_denied', 'Please sign in again');
  if (!res.ok || payload === null) {
    const e = codedError((payload && payload.error) || 'http_' + res.status);
    e.status = res.status;
    throw e;
  }
  return payload;
}

const enc = encodeURIComponent;

function makeDb() {
  const subs = new Map(); // col -> { listeners:Set, last:string, timer }

  async function refresh(col) {
    const s = subs.get(col);
    if (!s) return;
    let data;
    try { data = await api('GET', `/api/data/${enc(col)}`); }
    catch (e) { s.listeners.forEach(l => { try { l.onError && l.onError(e); } catch { /* ignore */ } }); return; }
    const items = (data && data.items) || [];
    const sig = JSON.stringify(items.map(i => [i.id, i.meta && i.meta.updatedAt]));
    if (sig === s.last) return; // unchanged: avoid needless re-renders
    s.last = sig;
    const snap = { docs: items.map(i => ({ id: i.id, data: () => i.data })) };
    s.listeners.forEach(l => { try { l.onNext(snap); } catch (err) { console.warn(err); } });
  }

  function subscribe(col, onNext, onError) {
    let s = subs.get(col);
    if (!s) {
      s = { listeners: new Set(), last: null, timer: null };
      subs.set(col, s);
      s.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(col); }, POLL_MS);
    }
    const l = { onNext, onError };
    s.listeners.add(l);
    s.last = null; // make sure the new listener gets the current data
    refresh(col);
    return () => {
      s.listeners.delete(l);
      if (!s.listeners.size) { clearInterval(s.timer); subs.delete(col); }
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') subs.forEach((_, col) => refresh(col));
  });

  function docRef(col, id) {
    return {
      async set(data) { await api('PUT', `/api/data/${enc(col)}/${enc(id)}`, data); refresh(col); },
      async delete() { await api('DELETE', `/api/data/${enc(col)}/${enc(id)}`); refresh(col); },
      onSnapshot(onNext, onError) {
        let stop = false, last = null;
        const load = async () => {
          if (stop) return;
          try {
            const rec = await api('GET', `/api/data/${enc(col)}/${enc(id)}`);
            const sig = JSON.stringify(rec.meta || null);
            if (sig !== last) { last = sig; onNext({ exists: true, id, data: () => rec.data }); }
          } catch (e) {
            if (e.status === 404) { if (last !== 'none') { last = 'none'; onNext({ exists: false, id, data: () => undefined }); } }
            else if (onError) onError(e);
          }
        };
        load();
        const t = setInterval(load, col === 'fx' ? FX_POLL_MS : POLL_MS);
        return () => { stop = true; clearInterval(t); };
      }
    };
  }

  return {
    collection(col) {
      return {
        doc: id => docRef(col, id),
        onSnapshot: (onNext, onError) => subscribe(col, onNext, onError)
      };
    },
    doc(path) {
      const [col, id] = String(path).split('/');
      return docRef(col, id);
    }
  };
}

function makeSample() {
  return {
    async json(prompt) {
      try {
        const out = await api('POST', '/api/ai', { prompt });
        return out.result;
      } catch (e) {
        if (e.status === 503) throw codedError('sampling_disabled');
        throw e;
      }
    }
  };
}

if (!window.claude || !window.claude.use) {
  let db = null, sample = null;
  window.claude = {
    async use(name) {
      const h = await health();
      if (name === 'db') {
        if (!h.db) throw codedError('not_granted', 'Database not configured');
        return db || (db = makeDb());
      }
      if (name === 'sample') {
        if (!h.ai) throw codedError('not_granted', 'AI not configured');
        return sample || (sample = makeSample());
      }
      throw codedError('not_granted', name + ' is not available here');
    }
  };
}
