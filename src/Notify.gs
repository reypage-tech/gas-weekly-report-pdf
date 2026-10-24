/**
 * 部品：通知。通知文を作って「通知ログ」シートに記録するだけ。実際には送らない。
 * 使う設定：APP_CONFIG.sheets.noticeLog / notify: { logHeader, toColumn, template: [行...] }
 *   template の {見出し} は台帳の行の値に置き換わる。先頭が ? の行は、値が空なら消える。
 */
function notifyBuildText_(rowObj) {
  return fillTemplate_(APP_CONFIG.notify.template, rowObj);
}

/** 通知文を作り、通知ログに1行記録する。戻り値の sent は常に false */
function notifyRecord_(rowObj) {
  var c = APP_CONFIG, n = c.notify;
  var to = rowObj[n.toColumn];
  var text = notifyBuildText_(rowObj);
  var log = getOrCreateSheet_(c.sheets.noticeLog, n.logHeader);
  var row = [dateTimeStr_(now_()), rowObj[c.receipt.label], to, text].map(safeCell_);
  // appendRow は実物ではセルの書式（書式なしテキスト）が効かず、日時が日付型になって時刻だけ表示されることがある。行の範囲を文字にしてから書く
  log.getRange(log.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return { to: to, text: text, sent: false };
}

/** 通知ログを見出しだけに戻す */
function notifyResetLog_() {
  var c = APP_CONFIG;
  var log = getOrCreateSheet_(c.sheets.noticeLog, c.notify.logHeader);
  log.clearContents();
  setTextFormat_(log, c.notify.logHeader.length);
  log.getRange(1, 1, 1, c.notify.logHeader.length).setValues([c.notify.logHeader]);
}

/**
 * 送信の部品は「空」のまま（意図的）。
 * この部品集はメールやチャットを送らない。送る仕組みが必要になったら、
 * 依頼ごとに送信先・文面・送る条件を確認してから、ここに別途作る（送る前に人が確認する形を推奨）。
 * 呼ばれたら必ずエラーにして、うっかり送る経路ができないようにしている。
 */
function notifySend_(notice) {
  throw new Error('notifySend_ は未実装です。この部品集では通知を送りません（通知ログへの記録だけ）。');
}
