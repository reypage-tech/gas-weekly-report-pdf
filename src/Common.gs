/**
 * 共通部品（どの部品からも使う）。業種ごとの値はすべて APP_CONFIG（configs/*.config.gs）から読む。
 * 日付は APP_CONFIG.tz（既定 Asia/Tokyo）で扱う。
 */
function cfg_() { return APP_CONFIG; }
function tz_() { return (APP_CONFIG && APP_CONFIG.tz) || 'Asia/Tokyo'; }

function now_() { return new Date(); }
function dateStr_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function dateTimeStr_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return dateStr_(now_()); }

/** 'yyyy-MM-dd' を日数に直す（比較用） */
function dayNumber_(ymd) {
  var p = String(ymd).split('-');
  return Math.floor(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000);
}
function ymdFromDayNumber_(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

/** 今週の初日（APP_CONFIG.summary.weekStart：1=月曜（既定）、0=日曜） */
function weekStartStr_() {
  var ws = (APP_CONFIG.summary && APP_CONFIG.summary.weekStart !== undefined) ? APP_CONFIG.summary.weekStart : 1;
  var n = dayNumber_(todayStr_());
  var dow = new Date(n * 86400000).getUTCDay();
  return ymdFromDayNumber_(n - ((dow - ws + 7) % 7));
}

/** シートを取得、なければ作る。見出しがあれば列を「書式なしテキスト」にしてから見出しを書く */
function getOrCreateSheet_(name, header) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header) {
      setTextFormat_(sh, header.length);
      sh.getRange(1, 1, 1, header.length).setValues([header]);
    }
  }
  return sh;
}

/** 列を「書式なしテキスト」にする。日付の文字が日付型に、= で始まる文字が数式に変わるのを防ぐ */
function setTextFormat_(sh, width) {
  sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');
}

/** 先頭が = + - @ の値に ' を付ける（数式として動かないように） */
function safeCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** セルの値を 'yyyy-MM-dd' に直す（実際のシートで日付型に変わっていても読める） */
function cellYmd_(v) {
  if (v instanceof Date) return dateStr_(v);
  return String(v).slice(0, 10);
}

function readRows_(sh, width) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 半角を全角にそろえる。半角英数字・記号は全角へ、半角スペースは全角スペースへ、
 * 半角カナは全角カナへ（濁点・半濁点はまとめて1文字に）。制御文字は取り除く。
 */
function normalizeName_(s) {
  s = String(s === undefined || s === null ? '' : s).replace(/[\x00-\x1F\x7F]/g, '').trim();
  s = s.replace(/[\uFF61-\uFF9F]+/g, function (m) { return m.normalize('NFKC'); });
  s = s.replace(/[\x21-\x7E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); });
  return s.replace(/ /g, '\u3000');
}

var URL_RE_ = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|jp|net|org|io|dev|co)\b)/i;
var MAIL_RE_ = /[^\s@＠]+[@＠][^\s@＠]+/;
var PHONE_RE_ = /[0-9０-９]{2,4}[-ー－‐]?[0-9０-９]{2,4}[-ー－‐]?[0-9０-９]{3,4}/;

/** URL・メール・電話番号の形を含むか（全角で書かれていても見つける） */
function containsContact_(s) {
  var n = String(s).normalize('NFKC');
  return [String(s), n].some(function (x) { return URL_RE_.test(x) || MAIL_RE_.test(x) || PHONE_RE_.test(x); });
}

/** '{見出し}' を値に置き換える。行の先頭が '?' の行は、置き換える値が空なら行ごと消す */
function fillTemplate_(lines, values) {
  var out = [];
  lines.forEach(function (line) {
    var optional = line.charAt(0) === '?';
    var body = optional ? line.slice(1) : line;
    var empty = false;
    var text = body.replace(/\{([^}]+)\}/g, function (_, k) {
      var v = values[k];
      if (v === undefined || v === null || v === '') { empty = true; return ''; }
      return String(v);
    });
    if (!(optional && empty)) out.push(text);
  });
  return out.join('\n');
}
