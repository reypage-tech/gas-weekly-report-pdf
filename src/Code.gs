/**
 * 広告と売上のシートを週ごとに集計し、週次サマリー表とPDFを作る。
 * 毎週月曜の朝（時間トリガー）に先週分を作り、メールの内容を「送信予定」シートに記録する（記録だけ。実際には送らない・共有しない）。
 * 読めない行は集計から外して管理者あての通知文を記録し、データが無い週は作らずに記録する。同じ週は二度作らない。
 * 使う部品：Common（共通）・Dedupe（二度作らない）・Pdf（PDF作成）・Notify（エラーは通知文を記録するだけ）
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('週次レポート').addItem('先週分を作る（送信は記録だけ）', 'weeklyReport').addItem('デモの週（2026-10-26〜）を作る', 'makeDemoWeek').addItem('デモを最初に戻す', 'resetDemo').addToUi();
}

/** トリガーとメニューから呼ぶ：先週（月〜日）の分を作る */
function weeklyReport() { return makeWeekly(lastWeekStart_()); }

/** デモ用：架空データの入っている週を指定して作る（今日の日付に関係なく試せる） */
function makeDemoWeek() { return makeWeekly(APP_CONFIG.demoWeek); }

function lastWeekStart_() { return ymdFromDayNumber_(dayNumber_(weekStartStr_()) - 7); }

/** ws：週の初日 'yyyy-MM-dd'（月曜）。戻り値 { ok, code?, week, made, skipped, excluded, fileName? } */
function makeWeekly(ws) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ws)) || new Date(dayNumber_(ws) * 86400000).getUTCDay() !== APP_CONFIG.summary.weekStart) {
    throw new Error('週の初日（月曜）を yyyy-MM-dd で指定してください: ' + ws);
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'BUSY' };
  var dd = null;
  try {
    dd = dedupeOpen_();
    if (dd.has(ws)) return { ok: true, week: ws, made: 0, skipped: 1 };
    var res = makeWeeklyLocked_(ws);
    if (res.made) dd.mark(ws, res.fileName);
    return res;
  } catch (err) {
    alertRecord_({ 対象: '週 ' + ws, エラー: String(err && err.message || err).slice(0, 200) });
    return { ok: false, code: 'ERROR', week: ws };
  } finally {
    if (dd) dd.flush();
    lock.releaseLock();
  }
}

function makeWeeklyLocked_(ws) {
  var c = APP_CONFIG;
  var we = ymdFromDayNumber_(dayNumber_(ws) + 6), prev = ymdFromDayNumber_(dayNumber_(ws) - 7);
  var agg = aggregate_(ws, prev);
  var cur = agg.weeks[ws], before = agg.weeks[prev];
  if (!cur.rows) {
    alertOnce_('週 ' + ws, 'この週の広告・売上のデータがありません（作りませんでした）');
    return { ok: false, code: 'NO_DATA', week: ws, made: 0, skipped: 0, excluded: agg.excluded };
  }
  var period = ws + '〜' + we;
  var table = buildTable_(cur, before);
  writeSummarySheet_(period, table, agg.excluded);
  appendTextRow_(getOrCreateSheet_(c.sheets.history, c.historyHeader), [ws, cur.cost, cur.clicks, cur.leads, cur.salesCount, cur.salesAmount, dateTimeStr_(now_())].map(function (v) { return safeCell_(String(v)); }));
  var lines = ['期間：' + period, '比べる週：' + prev + '〜' + ymdFromDayNumber_(dayNumber_(prev) + 6)];
  if (agg.excluded) lines.push('読めなかった行：' + agg.excluded + '行（集計から外しています）');
  var pdf = pdfFromRange_({ values: table, label: ws, lines: lines, folderId: reportFolder_() });
  sendRecord_(ws, period, cur, before, pdf, agg.excluded);
  return { ok: true, week: ws, made: 1, skipped: 0, excluded: agg.excluded, fileName: pdf.fileName, fileId: pdf.fileId };
}

function emptyWeek_() {
  var w = { rows: 0, cost: 0, clicks: 0, leads: 0, salesCount: 0, salesAmount: 0, media: {} };
  APP_CONFIG.media.forEach(function (m) { w.media[m] = { cost: 0, clicks: 0, leads: 0 }; });
  return w;
}

/** 0以上の数（「12,000」も可）。読めなければ null */
function num_(v) {
  if (typeof v === 'number') return v >= 0 && isFinite(v) ? v : null;
  var s = String(v).normalize('NFKC').replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** 2つの週（ws と prev）を集計。読めない行は通知文を記録して外す */
function aggregate_(ws, prev) {
  var c = APP_CONFIG, weeks = {}, excluded = 0;
  weeks[ws] = emptyWeek_(); weeks[prev] = emptyWeek_();
  function weekOf(ymd) {
    if (ymd >= ws && ymd <= ymdFromDayNumber_(dayNumber_(ws) + 6)) return weeks[ws];
    if (ymd >= prev && ymd < ws) return weeks[prev];
    return null;
  }
  function bad(sheet, i, msg) { excluded++; alertOnce_(sheet + ' ' + (i + 2) + '行目', msg); }
  readSheet_(c.sheets.ads, c.adsHeader).forEach(function (r, i) {
    if (r.every(function (v) { return String(v) === ''; })) return;
    var ymd = cellYmd_(r[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return bad(c.sheets.ads, i, '日付が読めません：' + String(r[0]).slice(0, 20));
    var w = weekOf(ymd); if (!w) return;
    var m = String(r[1]);
    if (c.media.indexOf(m) === -1) return bad(c.sheets.ads, i, '媒体が一覧にありません：' + m.slice(0, 20));
    var cost = num_(r[2]), clicks = num_(r[3]), leads = num_(r[4]);
    if (cost === null || clicks === null || leads === null) return bad(c.sheets.ads, i, '費用・クリック・申込のどれかが数字ではありません');
    w.rows++; w.cost += cost; w.clicks += clicks; w.leads += leads;
    w.media[m].cost += cost; w.media[m].clicks += clicks; w.media[m].leads += leads;
  });
  readSheet_(c.sheets.sales, c.salesHeader).forEach(function (r, i) {
    if (r.every(function (v) { return String(v) === ''; })) return;
    var ymd = cellYmd_(r[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return bad(c.sheets.sales, i, '日付が読めません：' + String(r[0]).slice(0, 20));
    var w = weekOf(ymd); if (!w) return;
    var n = num_(r[2]), amt = num_(r[3]);
    if (n === null || amt === null) return bad(c.sheets.sales, i, '件数・金額のどちらかが数字ではありません');
    w.rows++; w.salesCount += n; w.salesAmount += amt;
  });
  return { weeks: weeks, excluded: excluded };
}

/** シートが無ければ止める（名前の書き間違いに気づける） */
function readSheet_(name, header) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('シートがありません：' + name);
  return readRows_(sh, header.length);
}

function fmt_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function cpa_(w) { return w.leads ? w.cost / w.leads : null; }
function diff_(a, b) {
  if (a === null || b === null) return '-';
  var d = a - b, sign = d > 0 ? '+' : d < 0 ? '-' : '±';
  var pct = b ? '（' + sign + Math.round(Math.abs(d) / b * 100) + '%）' : '';
  return sign + fmt_(Math.abs(d)) + pct;
}

/** 週次サマリー表（1行目は見出し）。全体の数字のあとに媒体ごとの数字 */
function buildTable_(cur, before) {
  var c = APP_CONFIG, t = [c.summaryHeader.slice()];
  function row(label, a, b, unit) { t.push([label, a === null ? '-' : fmt_(a) + unit, b === null ? '-' : fmt_(b) + unit, diff_(a, b)]); }
  row('広告費', cur.cost, before.cost, '円');
  row('クリック', cur.clicks, before.clicks, '回');
  row('申込', cur.leads, before.leads, '件');
  row('申込1件あたりの広告費', cpa_(cur), cpa_(before), '円');
  row('売上件数', cur.salesCount, before.salesCount, '件');
  row('売上金額', cur.salesAmount, before.salesAmount, '円');
  c.media.forEach(function (m) {
    row('広告費：' + m, cur.media[m].cost, before.media[m].cost, '円');
    row('申込：' + m, cur.media[m].leads, before.media[m].leads, '件');
  });
  return t;
}

function writeSummarySheet_(period, table, excluded) {
  var c = APP_CONFIG, sh = getOrCreateSheet_(c.sheets.summary, null);
  sh.clearContents(); setTextFormat_(sh, c.summaryHeader.length);
  var head = [['週次レポート', period, excluded ? '読めなかった行：' + excluded + '行' : '', '']];
  sh.getRange(1, 1, 1, 4).setValues(head.map(function (r) { return r.map(safeCell_); }));
  sh.getRange(3, 1, table.length, 4).setValues(table.map(function (r) { return r.map(safeCell_); }));
}

/** 保存先フォルダ。無ければこのスクリプトで作る（drive.file で扱えるのは自分で作ったものだけ） */
function reportFolder_() {
  var c = APP_CONFIG, props = PropertiesService.getScriptProperties(), key = c.propPrefix + 'folder';
  var id = props.getProperty(key);
  if (!id) { id = Drive.Files.create({ name: c.rootFolderName, mimeType: 'application/vnd.google-apps.folder' }).id; props.setProperty(key, id); }
  return id;
}

/** メール本文を作る（送らない。送信予定シートに記録するだけ） */
function mailBody_(period, cur, before, fileName, excluded) {
  var lines = ['週次レポート（' + period + '）をお送りします。',
    '広告費：' + fmt_(cur.cost) + '円（前週比 ' + diff_(cur.cost, before.cost) + '）',
    '申込：' + fmt_(cur.leads) + '件（前週比 ' + diff_(cur.leads, before.leads) + '）',
    '売上金額：' + fmt_(cur.salesAmount) + '円（前週比 ' + diff_(cur.salesAmount, before.salesAmount) + '）',
    '添付：' + fileName];
  if (excluded) lines.push('読めなかった行が' + excluded + '行あります。エラー通知ログを確認してください。');
  return lines.join('\n');
}

function sendRecord_(ws, period, cur, before, pdf, excluded) {
  var c = APP_CONFIG, S = c.send;
  appendTextRow_(getOrCreateSheet_(c.sheets.send, S.header), [dateTimeStr_(now_()), ws, S.to, S.subject.replace('{週}', period),
    mailBody_(period, cur, before, pdf.fileName, excluded), pdf.fileName, pdf.fileId, S.status].map(safeCell_));
}

/** 同じ内容の通知は二度記録しない。記録したら 1、済みなら 0 */
function alertOnce_(target, msg) {
  var c = APP_CONFIG;
  var log = readRows_(getOrCreateSheet_(c.sheets.noticeLog, c.notify.logHeader), 4);
  if (log.some(function (r) { return String(r[1]) === target && String(r[3]).indexOf(msg) !== -1; })) return 0;
  alertRecord_({ 対象: target, エラー: msg });
  return 1;
}

function alertRecord_(info) {
  var o = { 宛先: APP_CONFIG.notify.to };
  Object.keys(info).forEach(function (k) { o[k] = info[k]; });
  return notifyRecord_(o);
}

/** 毎週月曜 8時台に weeklyReport を動かすトリガーを1つだけ作る */
function setupTriggers() {
  stopTriggers();
  var t = APP_CONFIG.trigger;
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay[t.weekDay]).atHour(t.hour).create();
}

/** このデモが作ったトリガー（weeklyReport）を全部消す */
function stopTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyReport') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/** デモを最初に戻す：架空の広告・売上を入れ直し、サマリー・記録・送信予定・ログを空にする（作ったPDFは消さない） */
function resetDemo() {
  var c = APP_CONFIG;
  // 記録にある古いPDFだけをゴミ箱へ（表を消す前に読む）
  var trash = pdfTrashRecorded_([{ sheet: c.sheets.send, header: c.send.header, col: 'ファイルID' }]);
  function fill(name, header, rows) {
    var sh = getOrCreateSheet_(name, header);
    sh.clearContents(); setTextFormat_(sh, 1); // 日付の列だけ文字のまま。数字の列は数として入れる
    sh.getRange(1, 1, 1 + rows.length, header.length).setValues([header].concat(rows));
  }
  fill(c.sheets.ads, c.adsHeader, demoAds_());
  fill(c.sheets.sales, c.salesHeader, demoSales_());
  [[c.sheets.history, c.historyHeader], [c.sheets.send, c.send.header]].forEach(function (x) {
    var sh = getOrCreateSheet_(x[0], x[1]);
    sh.clearContents(); setTextFormat_(sh, x[1].length);
    sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]);
  });
  getOrCreateSheet_(c.sheets.summary, null).clearContents();
  notifyResetLog_();
  dedupeReset_();
  PropertiesService.getScriptProperties().deleteProperty(c.propPrefix + 'folder'); // 保存先フォルダの記録も消す（次の実行で新しく作る）
  return { trashed: trash.trashed, skipped: trash.skipped.length };
}

/** 1行を書式なしテキストにしてから書く（実際のシートで日時や数字が日付型・時刻型に変わり、「9:11:06」のような表示や読み違いにならないように） */
function appendTextRow_(sh, row) {
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return r;
}
