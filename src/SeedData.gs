/** デモ用の架空データ（resetDemo で広告・売上シートに入れる）。会社・商品・数字はすべて架空 */
// 2026-10-19〜11-01 の2週間分。毎日の数は、決まった式で作る（乱数は使わない）
function demoAds_() {
  var out = [], base = dayNumber_('2026-10-19');
  var per = [[12000, 300, 6], [8000, 260, 4], [5000, 150, 2]]; // 媒体ごとの1日の目安：費用・クリック・申込
  for (var d = 0; d < 14; d++) {
    var ymd = ymdFromDayNumber_(base + d), wk2 = d >= 7 ? 1 : 0;
    APP_CONFIG.media.forEach(function (m, i) {
      var p = per[i], k = (d % 3) + wk2;
      out.push([ymd, m, p[0] + k * 1000, p[1] + k * 20, p[2] + (d % 2) + (wk2 && i === 0 ? 1 : 0)]);
    });
  }
  // 読めない行（エラー通知ログに記録して集計から外す）
  out.push(['2026-10-2x', '検索広告（架空）', 12000, 300, 5]);
  out.push(['2026-10-30', 'SNS広告（架空）', '千二百円', 200, 3]);
  out.push(['2026-10-31', 'ラジオ広告（架空）', 3000, 0, 0]);
  return out;
}
function demoSales_() {
  var out = [], base = dayNumber_('2026-10-19');
  for (var d = 0; d < 14; d++) {
    var ymd = ymdFromDayNumber_(base + d), wk2 = d >= 7 ? 1 : 0;
    out.push([ymd, '定番セット（架空）', 5 + (d % 3) + wk2, (5 + (d % 3) + wk2) * 4800]);
    out.push([ymd, 'お試しセット（架空）', 3 + (d % 2), (3 + (d % 2)) * 1980]);
  }
  return out;
}
