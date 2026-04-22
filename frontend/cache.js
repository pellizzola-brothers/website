function cacheSave(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data })); } catch(_) {}
}
function cacheLoad(key, ttl) {
  try {
    var raw = sessionStorage.getItem(key);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (Date.now() - obj.ts > ttl) { sessionStorage.removeItem(key); return null; }
    return obj.data;
  } catch(_) { return null; }
}
