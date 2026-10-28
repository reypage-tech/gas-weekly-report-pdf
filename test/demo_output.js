// node test/demo_output.js : test/run.js と同じモック上で weeklyReport を1回動かし、結果とPDFにする前の中身を JSON で出す。
// docs/local_test_output.png はこの出力から作った画像。実際の Apps Script・ドライブでは実行していない。
var fs = require('fs'), path = require('path'), vm = require('vm');
var mock = require('./mock_apis.js');
var B = path.join(__dirname, '..', 'src');
var FILES = ['Common.gs', 'Config.gs', 'SeedData.gs', 'Dedupe.gs', 'Notify.gs', 'Pdf.gs', 'Code.gs'];
var b = mock.buildMockGlobals({ nowMs: Date.UTC(2026, 9, 25, 23, 0, 0), docs: true });
var ctx = vm.createContext(b.globals);
FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(B, f), 'utf8'), ctx, { filename: f }); });
ctx.resetDemo();
var result = ctx.weeklyReport();
var w = b.world;
var pdfs = Object.keys(w.files).map(function (k) { return w.files[k]; }).filter(function (f) { return f.blob && f.blob.mime === 'application/pdf'; });
var out = { result: result, pdfs: pdfs.map(function (f) { var d = w.docs[f.blob.source]; return { name: f.meta.name, html: d ? d.html : '' }; }), log: {} };
['エラー通知ログ'].forEach(function (n) { var s = w.sheets[n]; out.log[n] = s ? s.__rows().filter(function (r) { return r.length && r[0] !== ''; }) : []; });
console.log(JSON.stringify(out));
