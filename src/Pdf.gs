/**
 * 部品：シートの範囲からPDFを作る（作るだけ。送らない・共有しない）。
 * 表を HTML にして、Drive 高度なサービスの Files.create で Googleドキュメントに変換し、
 * Drive API の export（UrlFetchApp で呼ぶ）で PDF にして指定フォルダに保存し、作業用のドキュメントは Files.remove で削除する（PDFだけを残す）。
 * ドキュメントのサービスは使わないので、ドキュメント全体の権限（auth/documents）は要らない。1日に作れる数の上限つき。
 * 必要な権限：drive.file（保存）＋ script.external_request（Google 自身の変換 API を呼ぶためだけ。宛先は www.googleapis.com の Drive export のみ）＋スプレッドシート。DriveApp は drive.file だけでは動かないので使わない。Drive 高度なサービス（v3）を有効にする。
 * 使う設定：APP_CONFIG.pdf: { title, note, fileNamePrefix, dailyLimit, folderId, minBytes?（これより小さいPDFは止める。既定 1000） }
 */
var PDF_DOC_MIME = 'application/vnd.google-apps.document';
var PDF_EXPORT_URL_ = 'https://www.googleapis.com/drive/v3/files/';

function pdfFileName_(label) {
  return APP_CONFIG.pdf.fileNamePrefix + '_' + label + '.pdf';
}

/** 画面に出る言葉。APP_CONFIG.pdf.text: { created, empty, limit } があればそれを使う（英語版など） */
function pdfText_(k, def) { var t = APP_CONFIG.pdf.text; return t && t[k] != null ? t[k] : def; }

function pdfDailyKey_() { return APP_CONFIG.propPrefix + 'pdf_' + todayStr_(); }

function pdfEsc_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 見出し・追加の行・表・注記から、変換用の HTML を作る（1行目は表の見出し） */
function pdfBuildHtml_(title, lines, values, note) {
  var h = ['<html><head><meta charset="utf-8"><style>',
    'body{font-family:sans-serif;font-size:10pt}table{border-collapse:collapse}',
    'th,td{border:1px solid #999;padding:3px 6px;text-align:left}th{background:#eee}',
    '</style></head><body>', '<h2>' + pdfEsc_(title) + '</h2>', '<p>' + pdfEsc_(pdfText_('created', '作成日：')) + pdfEsc_(todayStr_()) + '</p>'];
  (lines || []).forEach(function (l) { h.push('<p>' + pdfEsc_(l) + '</p>'); });
  if (values.length) {
    h.push('<table>');
    values.forEach(function (r, i) {
      var t = i === 0 ? 'th' : 'td';
      h.push('<tr>' + r.map(function (c) { return '<' + t + '>' + pdfEsc_(c) + '</' + t + '>'; }).join('') + '</tr>');
    });
    h.push('</table>');
  } else h.push('<p>' + pdfEsc_(pdfText_('empty', '（対象のデータなし）')) + '</p>');
  h.push('<p>' + pdfEsc_(note) + '</p></body></html>');
  return h.join('\n');
}

/** 範囲の値を読む。range を省くと、そのシートの見出しを含む全データ */
function pdfReadRange_(sheetName, range) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error('シートがありません: ' + sheetName);
  var r = range || { row: 1, col: 1, numRows: sh.getLastRow(), numCols: sh.getLastColumn() };
  if (r.numRows < 1 || r.numCols < 1) return [];
  return sh.getRange(r.row, r.col, r.numRows, r.numCols).getValues().map(function (row) {
    return row.map(function (v) { return v instanceof Date ? dateTimeStr_(v) : String(v); });
  });
}

/**
 * シートの範囲から PDF を1つ作って保存する。
 * opts: { sheetName, range?, values?: 2次元配列（渡せばシートを読まずにこれを表にする）, label, lines?: [見出しの下に入れる行], folderId?: 保存先（省くと APP_CONFIG.pdf.folderId） }
 * 戻り値：{ fileId, fileName, rowCount }
 */
function pdfFromRange_(opts) {
  var c = APP_CONFIG.pdf;
  var props = PropertiesService.getScriptProperties();
  var used = Number(props.getProperty(pdfDailyKey_()) || 0);
  if (used >= c.dailyLimit) throw new Error(pdfText_('limit', '本日のPDF作成の上限（{n}件）に達しました').replace('{n}', c.dailyLimit));

  var values = opts.values ? opts.values.map(function (r) { return r.map(function (v) { return v instanceof Date ? dateTimeStr_(v) : String(v); }); }) : pdfReadRange_(opts.sheetName, opts.range);
  var fileName = pdfFileName_(opts.label);
  var html = pdfBuildHtml_(c.title, opts.lines, values, c.note);
  var tmp = Drive.Files.create({ name: 'tmp_pdf_' + opts.label, mimeType: PDF_DOC_MIME },
    Utilities.newBlob(html, 'text/html', 'tmp_pdf_' + opts.label + '.html'));
  var file;
  try {
    var blob, res, failMsg = pdfText_('exportFail', 'PDFへの変換（export）に失敗しました：');
    try {
      res = UrlFetchApp.fetch(PDF_EXPORT_URL_ + tmp.id + '/export?mimeType=application/pdf',
        { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    } catch (e) { throw new Error(failMsg + (e && e.message ? e.message : e)); }
    var code = res.getResponseCode();
    if (code !== 200) throw new Error(failMsg + 'HTTP ' + code + ' ' + String(res.getContentText()).slice(0, 200));
    blob = res.getBlob().setName(fileName);
    // 変換がうまくいかないと、エラーにならずに中身の無いPDFができることがある。ごく小さいときは保存せずに止める
    var size = blob.getBytes().length, minBytes = c.minBytes || 1000;
    if (size < minBytes) throw new Error(pdfText_('tooSmall', 'PDFが小さすぎます（中身が無い可能性）：{n}バイト').replace('{n}', size));
    var meta = { name: fileName, mimeType: 'application/pdf' };
    var folderId = opts.folderId || c.folderId;
    if (folderId) meta.parents = [folderId];
    file = Drive.Files.create(meta, blob);
  } finally {
    Drive.Files.remove(tmp.id); // 失敗しても作業用ドキュメントは残さない
  }
  props.setProperty(pdfDailyKey_(), String(used + 1));
  return { fileId: file.id, fileName: fileName, rowCount: values.length };
}

/**
 * リセット用：このスクリプトが作って記録したPDFだけをゴミ箱へ移す（Drive 全体は探さない）。
 * list は [{ sheet: シート名, header: 見出しの配列, col: ファイルIDの見出し名 }]。記録のファイルIDだけを使うので drive.file のままで動く。
 * PDF以外・もう無いファイル・権限の無いファイルは飛ばして実行ログに書き、止めない。
 */
function pdfTrashRecorded_(list) {
  var res = { trashed: 0, skipped: [] }, seen = {}, ss = SpreadsheetApp.getActive();
  list.forEach(function (x) {
    var sh = ss.getSheetByName(x.sheet), j = x.header.indexOf(x.col);
    if (!sh || j < 0 || sh.getLastRow() < 2) return;
    sh.getRange(2, j + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var id = String(r[0] || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      try {
        var f = Drive.Files.get(id, { fields: 'mimeType,trashed' });
        if (f.mimeType !== 'application/pdf') { res.skipped.push(id + ' ' + pdfText_('trashNotPdf', 'PDFではないので残しました')); return; }
        if (f.trashed) return;
        Drive.Files.update({ trashed: true }, id);
        res.trashed++;
      } catch (e) { res.skipped.push(id + ' ' + pdfText_('trashSkip', '飛ばしました') + ': ' + (e && e.message ? e.message : e)); }
    });
  });
  res.skipped.forEach(function (s) { console.log(pdfText_('trashLog', '古いPDFのゴミ箱移動') + ': ' + s); });
  console.log(pdfText_('trashLog', '古いPDFのゴミ箱移動') + ': ' + res.trashed);
  return res;
}
