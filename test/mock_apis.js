// GAS の部品テスト用モック（node / vm）。gas_showcase/test/gas_mock/mock_apis.js のシート部分を簡略化して流用。
// MailApp は置いていない（呼べば ReferenceError で失敗する）。UrlFetchApp は docs のときだけ、Drive の export の宛先だけ受ける。DriveApp.getFileById は権限不足で必ず失敗する。Gmail・Drive 高度なサービスは読み取りと変換・保存の分だけ置く。
// 実際のスプレッドシートに近づけるため、書式が「書式なしテキスト（@）」でない列では
// 「2026-10-22」「2026-10-22 10:00:00」「10:00」「9:00:00」の形の文字列を Date に変え、先頭が = の文字列は数式として扱う（値は '#FORMULA'）。
// 先頭の ' は「文字列として入れる」印として外して保存する（Sheets と同じ）。
var MOCK_TOKEN_ = 'mock-token';
var DATE_LIKE_ = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
var TIME_LIKE_ = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
function coerce_(v, textCol) {
  if (typeof v !== 'string') return v;
  if (v.charAt(0) === "'") return v.slice(1);
  if (v.charAt(0) === '=') return '#FORMULA'; // 書式なしテキストの列でも数式として扱う（実物で確かめていないので、厳しい側に倒す）
  if (textCol) return v;
  var tm = v.match(TIME_LIKE_);
  if (tm) return new Date(Date.UTC(1899, 11, 30, Number(tm[1]) - 9, Number(tm[2]), Number(tm[3] || 0))); // 実物の時刻型（1899-12-30 の日時）に近づける
  if (DATE_LIKE_.test(v)) { var p = v.split(/[- :]/).map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], (p[3] || 0) - 9, p[4] || 0, p[5] || 0)); }
  return v;
}
function makeSheet(name) {
  var rows = [];
  var textCols = {};
  var bg = {};
  var api = {
    getName: function () { return name; },
    getLastRow: function () {
      for (var i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].some(function (v) { return v !== undefined && v !== ''; })) return i + 1;
      return 0;
    },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        setValues: function (vals) {
          if (vals.length !== nr || vals.some(function (v) { return v.length !== nc; })) throw new Error('setValues: 範囲と値の大きさが違う');
          vals.forEach(function (v, i) { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach(function (x, j) { rows[r - 1 + i][c - 1 + j] = coerce_(x, textCols[(r + i) + ',' + (c + j)]); }); });
          return this;
        },
        setBackground: function (col) { for (var i = 0; i < nr; i++) bg[r + i] = col; return this; },
        setNumberFormat: function (f) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) textCols[(r + i) + ',' + (c + j)] = (f === '@'); return this; }, // 書式はセルごと（実物と同じ）
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = rows[r - 1 + i] || []; var o = []; for (var j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); }
          return out;
        }
      };
    },
    // 実物の appendRow はセルの書式（@）が効かないことがある（実機で日時が時刻だけになった）。厳しい側に倒し、書式を見ずに変換する
    appendRow: function (v) { var n = api.getLastRow() + 1; rows.splice(n - 1, 0, v.map(function (x) { return coerce_(x, false); })); },
    getMaxRows: function () { return 1000; },
    getLastColumn: function () { var m = 0; rows.forEach(function (r) { if (r) for (var j = r.length - 1; j >= 0; j--) if (r[j] !== undefined && r[j] !== '') { m = Math.max(m, j + 1); break; } }); return m; },
    clearContents: function () { rows = []; },
    __bg: function (r) { return bg[r] || null; },
    __rows: function () { return rows.map(function (r) { return (r || []).slice(); }); }
  };
  return api;
}

function buildMockGlobals(opts) {
  opts = opts || {};
  var world = { nowMs: opts.nowMs || Date.UTC(2026, 9, 22, 1, 0, 0), props: {}, cache: {}, triggers: [], lockHeld: false, lockCalls: 0, sheets: {} };
  var RealDate = Date;
  function MockDate() {
    if (arguments.length === 0) return new RealDate(world.nowMs);
    return new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))();
  }
  MockDate.now = function () { return world.nowMs; };
  MockDate.UTC = RealDate.UTC; MockDate.parse = RealDate.parse; MockDate.prototype = RealDate.prototype;

  var ss = {
    getSheetByName: function (n) { return world.sheets[n] || null; },
    getSheets: function () { return Object.keys(world.sheets).map(function (k) { return world.sheets[k]; }); },
    insertSheet: function (n) { if (world.sheets[n]) throw new Error('同名のシートがある: ' + n); world.sheets[n] = makeSheet(n); return world.sheets[n]; }
  };
  var g = {
    console: console,
    Date: MockDate,
    SpreadsheetApp: { getActive: function () { return ss; } },
    Session: { getScriptTimeZone: function () { return opts.scriptTz || 'Asia/Tokyo'; } },
    LockService: { getScriptLock: function () { return {
      tryLock: function () { if (world.lockHeld || world.lockBusy) return false; world.lockHeld = true; world.lockCalls++; return true; },
      waitLock: function () { if (world.lockHeld) throw new Error('lock already held'); world.lockHeld = true; world.lockCalls++; },
      releaseLock: function () { world.lockHeld = false; } }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { var e = world.cache[k]; return e && e.exp > world.nowMs ? e.v : null; },
      put: function (k, v, sec) { world.cache[k] = { v: v, exp: world.nowMs + sec * 1000 }; } }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return world.props.hasOwnProperty(k) ? world.props[k] : null; },
      setProperty: function (k, v) { world.props[k] = String(v); },
      getKeys: function () { return Object.keys(world.props); },
      deleteProperty: function (k) { delete world.props[k]; } }; } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: function (t) { var o = { text: t, mime: null, setMimeType: function (m) { o.mime = m; return o; }, getContent: function () { return o.text; } }; return o; }
    },
    ScriptApp: {
      getOAuthToken: function () { return MOCK_TOKEN_; },
      WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' },
      newTrigger: function (fn) { var s = { fn: fn }; var b = {
        timeBased: function () { s.type = 'TIME'; return b; }, atHour: function (h) { s.hour = h; return b; },
        everyDays: function (d) { s.everyDays = d; return b; }, everyMinutes: function (m) { s.everyMinutes = m; return b; }, onWeekDay: function (d) { s.weekDay = d; return b; }, nearMinute: function (m) { s.minute = m; return b; }, inTimezone: function (z) { s.tz = z; return b; },
        create: function () { var t = { spec: s, getHandlerFunction: function () { return s.fn; } }; world.triggers.push(t); return t; } }; return b; },
      getProjectTriggers: function () { return world.triggers.slice(); },
      deleteTrigger: function (t) { world.triggers = world.triggers.filter(function (x) { return x !== t; }); }
    },
    Utilities: {
      base64DecodeWebSafe: function (str) { return Array.from(Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(function (b) { return b > 127 ? b - 256 : b; }); },
      newBlob: function (data, type, name) {
        var str = typeof data === 'string' ? data : Buffer.from(data.map(function (b) { return b & 255; })).toString('utf8');
        return { getDataAsString: function () { return str; }, getContentType: function () { return type || null; }, getName: function () { return name || null; } };
      },
      formatDate: function (d, tz, f) {
      var OFF = { 'Asia/Tokyo': 9, 'Etc/UTC': 0, 'UTC': 0 }; // fixed-offset zones only (no daylight saving)
      if (!(tz in OFF)) throw new Error('mock: Asia/Tokyo or Etc/UTC only');
      var j = new RealDate(d.getTime() + OFF[tz] * 3600000); function p(n) { return (n < 10 ? '0' : '') + n; }
      return f.replace('yyyy', j.getUTCFullYear()).replace('MM', p(j.getUTCMonth() + 1)).replace('dd', p(j.getUTCDate()))
        .replace('HH', p(j.getUTCHours())).replace('mm', p(j.getUTCMinutes())).replace('ss', p(j.getUTCSeconds())); } }
  };
  // PDF部品用（opts.docs が true のときだけ）：ドキュメントと Drive 高度なサービスのモック。メール系は作らない
  // Gmail の読み取り用（opts.gmail に架空のメール配列を渡したときだけ）。送信のメソッドは作らない
  if (opts.gmail) {
    world.mails = opts.gmail; world.searches = [];
    g.GmailApp = { search: function (q, start, max) {
      world.searches.push(q);
      if (world.gmailFail) throw new Error('Gmail search failed (mock)');
      return world.mails.slice(start || 0, (start || 0) + (max || 500)).map(function (m) {
        var msg = { getId: function () { return m.id; }, getSubject: function () { return m.subject; }, getPlainBody: function () { return m.body; },
          getDate: function () { return new RealDate(m.dateMs); }, getFrom: function () { return m.from; } };
        return { getMessages: function () { return [msg]; } };
      }); } };
    // Gmail 高度なサービス（users.messages.list / get、読み取りだけ）。本文は実物と同じく base64url で返す
    world.apiCalls = [];
    g.Gmail = { Users: { Messages: {
      list: function (user, o) {
        world.apiCalls.push({ list: o.q }); world.searches.push(o.q);
        if (world.gmailFail) throw new Error('Gmail list failed (mock)');
        var start = Number(o.pageToken || 0), max = o.maxResults || 100;
        var page = world.mails.slice().sort(function (a, b) { return b.dateMs - a.dateMs; }).slice(start, start + max).map(function (m) { return { id: m.id, threadId: 't' + m.id }; });
        var r = page.length ? { messages: page } : {};
        if (start + max < world.mails.length) r.nextPageToken = String(start + max);
        return r;
      },
      get: function (user, id, o) {
        var m = world.mails.filter(function (x) { return x.id === id; })[0];
        if (!m) throw new Error('not found ' + id);
        var data = Buffer.from(m.body, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
        var payload = m.html
          ? { mimeType: 'text/html', headers: [{ name: 'Subject', value: m.subject }, { name: 'From', value: m.from }], body: { data: Buffer.from(m.html, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_') } }
          : { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: m.subject }, { name: 'From', value: m.from }],
              parts: [{ mimeType: 'text/plain', body: { data: data } }, { mimeType: 'text/html', body: { data: '' } }] };
        return { id: m.id, internalDate: String(m.dateMs), payload: payload };
      }
    } } };
  }
  if (opts.docs) {
    world.docs = {}; world.files = {}; var seq = 0;
    g.DocumentApp = {
      ParagraphHeading: { HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3' },
      create: function (name) {
        var id = 'doc' + (++seq); var d = { id: id, name: name, items: [], page: {}, saved: false };
        world.docs[id] = d;
        var body = {
          setPageWidth: function (v) { d.page.w = v; return body; }, setPageHeight: function (v) { d.page.h = v; return body; },
          setMarginTop: function () { return body; }, setMarginBottom: function () { return body; },
          setMarginLeft: function () { return body; }, setMarginRight: function () { return body; },
          appendParagraph: function (t) { var p = { type: 'p', text: t }; d.items.push(p); return { setHeading: function (h) { p.heading = h; return this; } }; },
          appendTable: function (rows) { rows.forEach(function (r) { r.forEach(function (c) { if (typeof c !== 'string') throw new Error('appendTable: 文字列だけ'); }); }); d.items.push({ type: 'table', rows: rows }); return {}; }
        };
        return { getId: function () { return id; }, getBody: function () { return body; }, saveAndClose: function () { d.saved = true; } };
      }
    };
    // DriveApp は drive.file だけでは動かない（実物は drive.readonly か drive が要る）。マニフェストに無いので必ず失敗させる
    g.DriveApp = { getFileById: function () { throw new Error('You do not have permission to call DriveApp.getFileById. Required permissions: (https://www.googleapis.com/auth/drive.readonly || https://www.googleapis.com/auth/drive)'); } };
    // UrlFetchApp は Drive の export の宛先だけ受ける（ほかの宛先は失敗）。呼び出しは world.fetches に残す
    world.fetches = [];
    g.UrlFetchApp = { fetch: function (url, o) {
      o = o || {}; world.fetches.push({ url: url, opts: o });
      var m = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^\/?]+)\/export\?mimeType=application\/pdf$/.exec(url);
      if (!m) throw new Error('UrlFetchApp: 許可していない宛先 ' + url);
      if (world.fetchThrow) throw new Error('network error (mock)');
      var id = m[1], d = world.docs[id], code, text = '';
      var auth = o.headers && o.headers.Authorization;
      if (auth !== 'Bearer ' + MOCK_TOKEN_) { code = 401; text = 'Invalid Credentials'; }
      else if (!d || d.removed || !(d.saved || d.html != null)) { code = 404; text = 'File not found'; }
      else if (world.exportCode && world.exportCode !== 200) { code = world.exportCode; text = 'conversion failed (mock)'; }
      else if (world.exportFail) { code = 500; text = 'conversion failed (mock)'; }
      else code = 200;
      if (code !== 200 && o.muteHttpExceptions !== true) throw new Error('Request failed for https://www.googleapis.com returned code ' + code);
      // 大きさは world.exportBytes（既定 20000）。中身の無いPDFを試すときは小さくする
      var size = world.exportBytes == null ? 20000 : world.exportBytes;
      return { getResponseCode: function () { return code; }, getContentText: function () { return text; },
        getBlob: function () { if (code !== 200) throw new Error('getBlob: 200 以外'); var b = { mime: 'application/pdf', source: id, name: null, setName: function (n) { b.name = n; return b; }, getBytes: function () { return new Array(size).fill(37); } }; return b; } };
    } };
    g.Drive = { Files: {
      // 実物（v3）と同じく、alt=media なしの export は失敗させる。コードに戻ってきたらテストで分かる
      export: function () { throw new Error('Export requires alt=media to download the exported content.'); },
      create: function (meta, blob) {
        var id;
        if (meta.mimeType === 'application/vnd.google-apps.document') { // HTML、ドキュメントへの変換
          if (!blob || blob.getContentType() !== 'text/html') throw new Error('create: 変換には text/html が要る');
          id = 'doc' + (++seq); world.docs[id] = { id: id, name: meta.name, html: blob.getDataAsString(), items: [], page: {} }; return { id: id };
        }
        id = 'file' + (++seq); world.files[id] = { meta: meta, blob: blob, trashed: false }; return { id: id };
      },
      // 実物と同じく、もう無いID・world.denyIds にあるIDは失敗させる
      get: function (id, o) { if ((world.denyIds || []).indexOf(id) >= 0) throw new Error('The caller does not have permission'); var f = world.files[id] || world.docs[id]; if (!f || f.removed) throw new Error('File not found: ' + id); return { id: id, mimeType: world.docs[id] ? 'application/vnd.google-apps.document' : (f.meta.mimeType || (f.blob && f.blob.mime)), trashed: !!f.trashed }; },
      remove: function (id) { if (world.docs[id]) world.docs[id].removed = true; else if (world.files[id]) world.files[id].removed = true; else throw new Error('remove: not found'); },
      update: function (meta, id) { if ((world.denyIds || []).indexOf(id) >= 0) throw new Error('The caller does not have permission'); if (world.docs[id]) world.docs[id].trashed = !!meta.trashed; else if (world.files[id]) world.files[id].trashed = !!meta.trashed; return {}; }
    } };
  }
  return { globals: g, world: world };
}
module.exports = { buildMockGlobals: buildMockGlobals };
