/** 設定：架空のネットショップ（広告と売上のシートから、週次レポートを毎週月曜の朝に作るデモ）。業種ごとの値はここだけに置く */
var APP_CONFIG = {
  demoWeek: '2026-10-26', // デモの架空データが入っている週（makeDemoWeek で使う）
  tz: 'Asia/Tokyo',
  propPrefix: 'wk_',
  sheets: { ads: '広告', sales: '売上', summary: '週次サマリー', history: '週次記録', send: '送信予定', noticeLog: 'エラー通知ログ' },
  adsHeader: ['日付', '媒体', '費用', 'クリック', '申込'],
  salesHeader: ['日付', '商品', '件数', '金額'],
  media: ['検索広告（架空）', 'SNS広告（架空）', '動画広告（架空）'],
  products: ['定番セット（架空）', 'お試しセット（架空）'],
  historyHeader: ['週', '費用', 'クリック', '申込', '売上件数', '売上金額', '作成日時'],
  summaryHeader: ['項目', '今週', '前週', '増減'],
  summary: { weekStart: 1 }, // 1=月曜はじまり
  trigger: { weekDay: 'MONDAY', hour: 8 }, // 毎週月曜 8時台に先週分を作る
  rootFolderName: '週次レポート（架空デモ）',
  dedupe: { sheet: '作成済みの週' },
  receipt: { label: '対象' },
  pdf: { title: '週次レポート', note: '※架空のネットショップ・架空の数字によるデモです。', fileNamePrefix: '週次レポート', dailyLimit: 20, folderId: '' },
  // 送信は記録だけ（実際には送らない）。本番で送るときは、送信先・文面・条件を確かめてから別に作る
  send: {
    header: ['記録日時', '週', '宛先', '件名', '本文', 'ファイル名', 'ファイルID', '状態'],
    to: '営業チーム（架空）',
    subject: '週次レポート {週}',
    status: '未送信（記録のみ）'
  },
  notify: {
    logHeader: ['記録日時', '対象', '宛先', '通知文'],
    toColumn: '宛先',
    to: '管理者（架空）',
    template: ['{宛先} さん', '週次レポートの作成で確認が必要なものがあります。', '対象：{対象}', '内容：{エラー}', 'エラー通知ログと元のシートを確認してください。']
  }
};
