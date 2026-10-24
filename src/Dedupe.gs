/**
 * 部品：二重取り込みの防止。処理したもののキー（フォームの回答ID・メールID・行のキーなど）を
 * 「処理済み」シートに1行ずつ残し、同じキーは二度処理しない。
 * キーと日時は文字のまま保存する（シートの書式を「書式なしテキスト」にして、数字や日付に化けないようにする）。
 * 使う設定：APP_CONFIG.dedupe: { sheet: '処理済み' }
 * 使い方：
 *   var dd = dedupeOpen_();
 *   items.forEach(function (x) { if (dd.has(x.id)) return; ...処理...; dd.mark(x.id, '追加'); });
 *   dd.flush();   // 最後にまとめて書く（途中で止まっても、flush 前の分はもう一度処理される＝取りこぼさない側に倒す）
 */
var DEDUPE_HEADER_JA = ['キー', '処理日時', '結果'];
/** 見出しは APP_CONFIG.dedupe.header があればそれ（英語版など） */
function dedupeHeader_() { return APP_CONFIG.dedupe.header || DEDUPE_HEADER_JA; }

function dedupeSheet_() {
  var sh = getOrCreateSheet_(APP_CONFIG.dedupe.sheet, dedupeHeader_());
  setTextFormat_(sh, dedupeHeader_().length);
  return sh;
}

function dedupeOpen_() {
  var sh = dedupeSheet_();
  var seen = {}, pending = [];
  readRows_(sh, dedupeHeader_().length).forEach(function (r) { seen[String(r[0])] = true; });
  return {
    has: function (key) { return seen[String(key)] === true; },
    mark: function (key, result) {
      var k = String(key);
      if (!k) throw new Error('dedupe: キーが空です');
      if (seen[k]) return false;
      seen[k] = true;
      pending.push([k, dateTimeStr_(now_()), String(result || '')].map(safeCell_));
      return true;
    },
    pendingCount: function () { return pending.length; },
    flush: function () {
      if (!pending.length) return 0;
      var start = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(start, 1, pending.length, dedupeHeader_().length).setValues(pending);
      var n = pending.length; pending = [];
      return n;
    }
  };
}

/** 処理済みの記録を見出しだけに戻す */
function dedupeReset_() {
  var sh = dedupeSheet_();
  sh.clearContents();
  setTextFormat_(sh, dedupeHeader_().length);
  sh.getRange(1, 1, 1, dedupeHeader_().length).setValues([dedupeHeader_()]);
}
