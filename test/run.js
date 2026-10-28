// node test/run.js : モック上で src/*.gs を動かして確かめる。実際のApps Script・ドライブでは実行していない。
var fs = require('fs'), path = require('path'), vm = require('vm');
var mock = require('./mock_apis.js');
var B = path.join(__dirname, '..', 'src');
var FILES = ['Common.gs', 'Config.gs', 'SeedData.gs', 'Dedupe.gs', 'Notify.gs', 'Pdf.gs', 'Code.gs'];
var T0 = Date.UTC(2026, 9, 25, 23, 0, 0); // 2026-10-26（月）08:00 JST
var res = [];
function ok(name, cond, detail) { res.push(!!cond); console.log((cond ? '[OK] ' : '[NG] ') + name + (cond || !detail ? '' : ' - ' + detail)); }
function env(nowMs) {
  var b = mock.buildMockGlobals({ nowMs: nowMs || T0, docs: true });
  var ctx = vm.createContext(b.globals);
  FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(B, f), 'utf8'), ctx, { filename: f }); });
  ctx.resetDemo();
  return { ctx: ctx, w: b.world };
}
function rows(e, n) { var s = e.w.sheets[n]; return s ? s.__rows().slice(1).filter(function (r) { return r.length && r[0] !== ''; }) : []; }
function pdfs(e) { return Object.keys(e.w.files).map(function (k) { var f = e.w.files[k]; f.id = k; return f; }).filter(function (f) { return f.blob && f.blob.mime === 'application/pdf'; }); }
function unesc(t) { return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
function table(html) { return (html.match(/<tr>.*?<\/tr>/g) || []).map(function (tr) { return (tr.match(/<t[hd]>(.*?)<\/t[hd]>/g) || []).map(function (c) { return unesc(c.replace(/<\/?t[hd]>/g, '')); }); }); }
function rowOf(t, label) { return t.filter(function (r) { return r[0] === label; })[0]; }
function log(e) { return rows(e, 'エラー通知ログ'); }

// 期待値は、架空データの式から別に手で計算したもの（集計のコードは使っていない）
// 10/26〜11/01：広告費 217,000円・クリック 5,810回・申込 103件・売上 74件 284,700円
// 10/19〜10/25：広告費 193,000円・クリック 5,330回・申込 93件・売上 65件 244,320円
(function () {
  var e = env();
  ok('W01 先週は 2026-10-19（月）から', e.ctx.lastWeekStart_() === '2026-10-19');
  var r = e.ctx.weeklyReport();
  ok('W02 結果：作成1・読めない行3', r.ok && r.made === 1 && r.week === '2026-10-19' && r.excluded === 3, JSON.stringify(r));
  var s = e.w.sheets['週次サマリー'].__rows();
  ok('W03 サマリーの1行目に期間と読めない行の数', s[0][1] === '2026-10-19〜2026-10-25' && s[0][2] === '読めなかった行：3行');
  var t = s.slice(2).filter(function (x) { return x.length && x[0] !== ''; });
  ok('W04 見出し', t[0].join() === '項目,今週,前週,増減');
  ok('W05 広告費：217,000円・前週 193,000円・+24,000（+12%）', rowOf(t, '広告費').join() === '広告費,217,000円,193,000円,+24,000（+12%）', JSON.stringify(rowOf(t, '広告費')));
  ok('W06 クリック・申込', rowOf(t, 'クリック')[1] === '5,810回' && rowOf(t, '申込').join() === '申込,103件,93件,+10（+11%）');
  ok('W07 申込1件あたりの広告費：2,107円・前週 2,075円（四捨五入）', rowOf(t, '申込1件あたりの広告費').slice(1, 3).join() === '2,107円,2,075円');
  ok('W08 売上：74件・284,700円（前週 244,320円）', rowOf(t, '売上件数')[1] === '74件' && rowOf(t, '売上金額').join() === '売上金額,284,700円,244,320円,+40,380（+17%）');
  var ads = e.ctx.demoAds_().filter(function (x) { return /^\d{4}-\d\d-\d\d$/.test(x[0]) && x[0] >= '2026-10-19' && x[0] <= '2026-10-25' && x[1] === '検索広告（架空）'; });
  var sc = ads.reduce(function (a, x) { return a + x[2]; }, 0);
  ok('W09 媒体ごと：検索広告の広告費が元の行の合計（98,000円・日付の読めない行は除く）と一致', sc === 98000 && rowOf(t, '広告費：検索広告（架空）')[1] === '98,000円', JSON.stringify(rowOf(t, '広告費：検索広告（架空）')) + sc);
  ok('W10 SNS広告の「千二百円」の行は入らない', rowOf(t, '広告費：SNS広告（架空）')[1] === e.ctx.demoAds_().filter(function (x) { return x[0] >= '2026-10-19' && x[0] <= '2026-10-25' && x[1] === 'SNS広告（架空）' && typeof x[2] === 'number'; }).reduce(function (a, x) { return a + x[2]; }, 0).toLocaleString('en-US') + '円');
  var L = log(e);
  ok('W11 読めない行3つがエラー通知ログへ（日付・数字・媒体）', L.length === 3 && L.some(function (x) { return /日付が読めません：2026-10-2x/.test(x[3]); }) && L.some(function (x) { return /数字ではありません/.test(x[3]); }) && L.some(function (x) { return /媒体が一覧にありません：ラジオ広告/.test(x[3]); }), JSON.stringify(L));
  ok('W12 通知の宛先は管理者（架空）・記録だけ', L.every(function (x) { return x[2] === '管理者（架空）'; }));
  var P = pdfs(e);
  ok('W13 PDFは1つ・名前は 週次レポート_2026-10-19.pdf', P.length === 1 && P[0].meta.name === '週次レポート_2026-10-19.pdf');
  var folder = Object.keys(e.w.files).map(function (k) { return e.w.files[k]; }).filter(function (f) { return f.meta.mimeType === 'application/vnd.google-apps.folder'; });
  ok('W14 PDFは「週次レポート（架空デモ）」フォルダに保存', folder.length === 1 && folder[0].meta.name === '週次レポート（架空デモ）' && P[0].meta.parents[0] === e.w.props['wk_folder']);
  var doc = e.w.docs[P[0].blob.source];
  ok('W15 PDFの表はサマリー表と同じ・期間と読めない行の注記つき', JSON.stringify(table(doc.html)) === JSON.stringify(t) && doc.html.indexOf('<p>期間：2026-10-19〜2026-10-25</p>') > 0 && doc.html.indexOf('読めなかった行：3行') > 0);
  ok('W16 作業用ドキュメントは削除', doc.removed === true);
  var S = rows(e, '送信予定');
  ok('W17 送信予定1行：宛先・件名・状態（記録のみ）', S.length === 1 && S[0][1] === '2026-10-19' && S[0][2] === '営業チーム（架空）' && S[0][3] === '週次レポート 2026-10-19〜2026-10-25' && S[0][7] === '未送信（記録のみ）', JSON.stringify(S));
  ok('W18 本文に広告費・申込・売上の前週比と添付名、読めない行の案内', /広告費：217,000円（前週比 \+24,000（\+12%））/.test(S[0][4]) && /申込：103件/.test(S[0][4]) && /売上金額：284,700円/.test(S[0][4]) && /添付：週次レポート_2026-10-19\.pdf/.test(S[0][4]) && /読めなかった行が3行/.test(S[0][4]));
  ok('W19 送信予定のファイルIDは作ったPDF', S[0][6] === P[0].id && S[0][5] === P[0].meta.name);
  var H = rows(e, '週次記録');
  ok('W20 週次記録に1行（数は文字のまま）', H.length === 1 && H[0].slice(0, 6).join() === '2026-10-19,217000,5810,103,74,284700');

  var r2 = e.ctx.weeklyReport();
  ok('W21 2回目は作らない（同じ週は二度作らない）', r2.ok && r2.made === 0 && r2.skipped === 1 && pdfs(e).length === 1 && rows(e, '送信予定').length === 1 && rows(e, '週次記録').length === 1, JSON.stringify(r2));
  ok('W22 2回目でエラー通知が増えない', log(e).length === 3);
  var r3 = e.ctx.makeWeekly('2026-10-12');
  ok('W23 前の週（10/19）も指定すれば作れる・その前の週は0で増減は「-」', r3.made === 1 && pdfs(e).length === 2 && rowOf(table(e.w.docs[pdfs(e)[1].blob.source].html), '広告費').join() === '広告費,193,000円,0円,+193,000');
})();

(function () {
  var e = env();
  var r = e.ctx.makeWeekly('2026-10-26');
  ok('E01 データが無い週は作らず、通知を記録', r.ok === false && r.code === 'NO_DATA' && pdfs(e).length === 0 && rows(e, '送信予定').length === 0 && log(e).some(function (x) { return /データがありません/.test(x[3]); }));
  ok('E02 データが無い週は「作成済み」にしない（あとで入れれば作れる）', rows(e, '作成済みの週').length === 0);
  e.ctx.makeWeekly('2026-10-26');
  ok('E02b データが無い週をもう一度動かしても、同じ通知は1回だけ（毎週の自動実行で通知が積もらない）', log(e).filter(function (x) { return /データがありません/.test(x[3]); }).length === 1);
  var th = 0; ['2026/10/19', '2026-10-20', 'x'].forEach(function (w) { try { e.ctx.makeWeekly(w); } catch (err) { th++; } });
  ok('E03 週の初日が月曜の yyyy-MM-dd でなければ止まる', th === 3);
  e.w.lockBusy = true;
  ok('E04 実行中なら BUSY', e.ctx.weeklyReport().code === 'BUSY');
})();

(function () {
  var e = env(); e.w.exportFail = true;
  var r = e.ctx.weeklyReport();
  var docs = Object.keys(e.w.docs).map(function (k) { return e.w.docs[k]; });
  ok('E05 PDFにできないとき：止めて記録・作業用は削除・送信予定なし・作成済みにしない', r.ok === false && r.code === 'ERROR' && pdfs(e).length === 0 && docs.every(function (d) { return d.removed; }) && rows(e, '送信予定').length === 0 && rows(e, '作成済みの週').length === 0 && log(e).some(function (x) { return /export/.test(x[3]); }), JSON.stringify(r));
  e.w.exportFail = false;
  ok('E06 直った次の実行で作れる', e.ctx.weeklyReport().made === 1 && rows(e, '送信予定').length === 1);
})();

(function () {
  var e = env(); e.w.exportBytes = 200;
  var r = e.ctx.weeklyReport();
  var docs = Object.keys(e.w.docs).map(function (k) { return e.w.docs[k]; });
  ok('E05b ごく小さいPDF：保存せず止めて記録・作業用は削除・送信予定なし・作成済みにしない', r.ok === false && pdfs(e).length === 0 && docs.every(function (d) { return d.removed; }) && rows(e, '送信予定').length === 0 && rows(e, '作成済みの週').length === 0 && log(e).some(function (x) { return /小さすぎ/.test(x[3]); }), JSON.stringify(r));
  e.w.exportBytes = null;
  ok('E06b 直った次の実行で作れる', e.ctx.weeklyReport().made === 1);
})();

(function () {
  var e = env();
  delete e.w.sheets['売上'];
  var r = e.ctx.weeklyReport();
  ok('E07 シートが無ければ止めて記録（名前の書き間違いに気づける）', r.code === 'ERROR' && log(e).some(function (x) { return /シートがありません：売上/.test(x[3]); }));
})();

(function () {
  var e = env();
  // 実際のシートで日付が日付型・数字が「12,000」の文字に変わっていても数える
  var sh = e.w.sheets['広告'];
  sh.appendRow([new Date(Date.UTC(2026, 9, 24, 3, 0, 0)), '動画広告（架空）', '１２,０００', '100', '2']);
  sh.appendRow(['2026-10-25', '検索広告（架空）', "'=1+1", 0, 0]);
  var r = e.ctx.weeklyReport();
  var t = table(e.w.docs[pdfs(e)[0].blob.source].html);
  ok('E08 日付型の日付・全角やカンマの数字も数える', rowOf(t, '広告費')[1] === '229,000円' && r.excluded === 4, JSON.stringify(rowOf(t, '広告費')) + r.excluded);
  ok('E09 = で始まる値は数字として読まず、読めない行に', log(e).some(function (x) { return /数字ではありません/.test(x[3]) && /広告 \d+行目/.test(x[1]); }) && log(e).length === 4);
})();

(function () {
  var e = env(Date.UTC(2026, 8, 14, 0, 0, 0));
  var r = e.ctx.makeDemoWeek();
  ok('D01 makeDemoWeek は今日の日付に関係なくデモの週（2026-10-19）を作る', r.made === 1 && r.week === '2026-10-19' && pdfs(e).length === 1);
  ok('D02 同じ日の weeklyReport は先週（2026-09-07）にデータが無いので作らない', e.ctx.weeklyReport().code === 'NO_DATA');
})();

(function () {
  var e = env();
  e.ctx.setupTriggers(); e.ctx.setupTriggers();
  var T = e.w.triggers;
  ok('T01 トリガーは1つだけ・毎週月曜 8時台に weeklyReport', T.length === 1 && T[0].spec.fn === 'weeklyReport' && T[0].spec.weekDay === 'MONDAY' && T[0].spec.hour === 8);
  ok('T02 stopTriggers で消える', e.ctx.stopTriggers() === 1 && e.w.triggers.length === 0);
  e.ctx.weeklyReport(); e.ctx.resetDemo();
  ok('T03 resetDemo で記録・送信予定・ログ・作成済みが空に（PDFは消さない）', rows(e, '週次記録').length === 0 && rows(e, '送信予定').length === 0 && log(e).length === 0 && rows(e, '作成済みの週').length === 0 && pdfs(e).length === 1);
  ok('T04 resetDemo のあとはもう一度作れる', e.ctx.weeklyReport().made === 1);
  var f1 = e.w.props['wk_folder']; e.ctx.resetDemo();
  ok('T05 resetDemo で保存先フォルダのIDも消え、次の実行で新しいフォルダを作る', !('wk_folder' in e.w.props) && !!f1 && e.ctx.weeklyReport().made === 1 && !!e.w.props['wk_folder'] && e.w.props['wk_folder'] !== f1);
})();

(function () {
  var code = FILES.map(function (f) { return fs.readFileSync(path.join(B, f), 'utf8'); }).join('\n');
  ok('X01 送信・共有・外部通信の処理がない', !/\b(GmailApp|MailApp)\b|\bGmail\.|addViewer|addEditor|setSharing|permissions\.create/i.test(code));
  ok('X02 DriveApp・getAs・DocumentApp を使わない（DriveApp は drive.file だけでは動かない）', !/\bDriveApp\b|\.getAs\s*\(|\bDocumentApp\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  ok('X07 外部への通信は Pdf.gs の Drive の export 1か所だけ（宛先は www.googleapis.com）', (code.replace(/\/\*[\s\S]*?\*\//g, '').match(/\bUrlFetchApp\b/g) || []).length === 1 && (FILES.filter(function (f) { return /\.gs$/.test(f); }).map(function (f) { return fs.readFileSync(path.join(B, f), 'utf8'); }).join('\n').match(/https:\/\//g) || []).length === 1 && code.indexOf("var PDF_EXPORT_URL_ = 'https://www.googleapis.com/drive/v3/files/';") >= 0 && /UrlFetchApp\.fetch\(PDF_EXPORT_URL_ \+ tmp\.id \+ '\/export\?mimeType=application\/pdf',/.test(fs.readFileSync(path.join(B, 'Pdf.gs'), 'utf8')));
  ok('X08 Drive.Files.export を使わない（v3 では alt=media が要り失敗する）', !/Files\.export\s*\(/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  var man = JSON.parse(fs.readFileSync(path.join(B, 'appsscript.json'), 'utf8'));
  ok('X03 権限は4つだけ（このシート・自分で作ったファイル・Google の変換を呼ぶ外部接続・トリガー）', man.oauthScopes.join() === ['spreadsheets.currentonly', 'drive.file', 'script.external_request', 'script.scriptapp'].map(function (s) { return 'https://www.googleapis.com/auth/' + s; }).join());
  ok('X04 notifySend_ を呼ばない', !/notifySend_\(/.test(fs.readFileSync(path.join(B, 'Code.gs'), 'utf8')));
  var c2 = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(B, 'Config.gs'), 'utf8'), c2);
  ok('X05 架空の表記：媒体・商品・宛先', vm.runInContext('APP_CONFIG.media.concat(APP_CONFIG.products,[APP_CONFIG.send.to,APP_CONFIG.notify.to]).every(function(x){return /（架空）$/.test(x);})', c2));
})();

(function () {
  var e = env(), H = e.ctx.APP_CONFIG.historyHeader;
  delete e.w.sheets['週次記録'];
  var sh = e.ctx.SpreadsheetApp.getActive().insertSheet('週次記録'); sh.getRange(1, 1, 1, H.length).setValues([H]);
  e.ctx.makeDemoWeek();
  var v = rows(e, '週次記録').map(function (x) { return x[6]; });
  ok('K01 書式なしで手で作ったシートでも、作成日時は0埋めの文字（yyyy-MM-dd HH:mm:ss）で入る', v.length >= 1 && v.every(function (x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x); }), JSON.stringify(v));
})();

(function () {
  var e = env(); e.ctx.alertRecord_({});
  var v = (rows(e, 'エラー通知ログ').pop() || [])[0];
  ok('L01 エラー通知ログの時刻は日付つき（yyyy-MM-dd HH:mm:ss の文字）', typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v), String(v));
})();

(function () {
  var e = env(); e.ctx.makeDemoWeek();
  var ids = Object.keys(e.w.files).filter(function (k) { var f = e.w.files[k]; return f.blob && f.blob.mime === 'application/pdf'; });
  e.w.files.other1 = { meta: { name: 'other.pdf', mimeType: 'application/pdf' }, blob: { mime: 'application/pdf' }, trashed: false };
  var r = e.ctx.resetDemo();
  var folders = Object.keys(e.w.files).filter(function (k) { return e.w.files[k].meta.mimeType === 'application/vnd.google-apps.folder'; });
  ok('T10 resetDemo は記録にある古いPDFだけをゴミ箱へ（記録外のPDF・フォルダは残す）', ids.length > 0 && ids.every(function (k) { return e.w.files[k].trashed; }) && r.trashed === ids.length && !e.w.files.other1.trashed && folders.length > 0 && folders.every(function (k) { return !e.w.files[k].trashed; }), JSON.stringify(r));
  var e2 = env(); e2.ctx.makeDemoWeek();
  var ids2 = Object.keys(e2.w.files).filter(function (k) { var f = e2.w.files[k]; return f.blob && f.blob.mime === 'application/pdf'; });
  e2.w.files[ids2[0]].removed = true; e2.w.denyIds = ids2.length > 1 ? [ids2[1]] : [];
  var logs = [], cl = e2.ctx.console.log; e2.ctx.console.log = function (m) { logs.push(String(m)); };
  var r2, err = null; try { r2 = e2.ctx.resetDemo(); } catch (x) { err = x; }
  e2.ctx.console.log = cl;
  var expSkip = ids2.length > 1 ? 2 : 1;
  ok('T11 もう無い・権限の無いPDFは飛ばして止まらない（ログに書く）', !err && r2.skipped === expSkip && r2.trashed === ids2.length - expSkip && logs.filter(function (m) { return m.indexOf(ids2[0]) >= 0; }).length === 1 && rows(e2, e2.ctx.APP_CONFIG.sheets.send).length === 0, String(err) + JSON.stringify(r2) + logs.join('|'));
  ok('T12 Drive 全体の検索（Files.list）を使わない', !/Files\.list|DriveApp\.(search|getFiles)/.test(require('fs').readFileSync(require('path').join(B, 'Pdf.gs'), 'utf8') + require('fs').readFileSync(require('path').join(B, 'Code.gs'), 'utf8')));
})();
var n = res.filter(Boolean).length;
console.log('\n' + n + ' OK / ' + (res.length - n) + ' NG (total ' + res.length + ')');
process.exit(n === res.length ? 0 : 1);
