// 특가 소구 이미지 자동 생성 (Claude가 채팅 요청을 받아 실행)
//   node NBDB/sogu/make.mjs <PK> [--saved] [--over 문구.json] [--out 폴더]
//   --saved : NBDB 탭에서 이 PK에 자동 저장된 설정·내 사진(/api/sogu)을 그대로 쓴다. --over 를 같이 주면 그 값이 덮어씀.
//   문구.json (모두 선택): { "hook2": "상품명(숙소명 아래 크게)", "hook1": "서브카피(작게)", "due": "10월 18일까지",
//     "stars": [{ "title": "강조 포인트", "desc": "설명", "hook": "훅 2줄째에 쓸 짧은 표현" }],
//     "extras": [{ "title": "일반 카드로 추가할 포인트", "desc": "설명", "imageIndex": 3 }],
//     "uploads": ["C:/…/내사진.jpg"],  (놀발 사진 뒤 번호로 이어짐 → imageIndex/heroIndex 로 지정)
//     "hide": ["rooms"], "chips": ["닭강정 세트 제공", "키즈클래스 1+1 제공", "주중 1시간 레이트 체크아웃"] (인트로 칩은 핵심만 짧게, 조건은 카드 설명에), "heroIndex": 0,
//     "listPrice": 192000, "cta": "..." }
//   결과: <폴더>/<PK>_<숙소명>_<날짜>.jpg (업로드용 전체) + _fold.png (놀발 접힌 화면 미리보기) + .json (모델)
// 템플릿은 NBDB 탭과 같은 sogu.js / sogu.css 를 쓴다. Playwright 는 naver-blog-auto 의 것을 빌려 쓴다.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.USERPROFILE || 'C:/Users/leeinsung', 'naver-blog-auto', 'package.json'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const pk = args.find((a) => /^\d+$/.test(a));
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
if (!pk) {
  console.error('사용법: node make.mjs <PK> [--over 문구.json] [--out 폴더]');
  process.exit(1);
}
let saved = {};
if (args.includes('--saved')) {
  const j = await (await fetch(`https://price-scraper-iota.vercel.app/api/sogu?pk=${pk}`)).json();
  if (!j.ok) throw new Error(j.error || '저장된 설정을 못 읽었어요.');
  if (!j.setup) console.error(`※ PK ${pk}는 탭에 저장된 설정이 없어요 — 자동 문구로 만듭니다.`);
  saved = (j.setup && j.setup.over) || {};
}
const over = { ...saved, ...(opt('--over') ? JSON.parse(fs.readFileSync(opt('--over'), 'utf8')) : {}) };
// "uploads": ["C:/…/사진.jpg", …] — 사용자가 보낸 사진 파일. 놀발 사진 뒤에 번호가 이어진다(엔진과 같음).
if (Array.isArray(over.uploads)) {
  const mime = (f) => ({ '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })[path.extname(f).toLowerCase()] || 'image/jpeg';
  over.uploads = over.uploads.map((f) => (/^(data|https?):/.test(f) ? f : `data:${mime(f)};base64,${fs.readFileSync(f).toString('base64')}`));
}
const outDir = opt('--out') || path.join(process.env.USERPROFILE || 'C:/Users/leeinsung', 'sogu-output');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1 });
  await page.addInitScript((o) => { window.__OVER__ = o; }, over);
  await page.goto(pathToFileURL(path.join(here, 'render.html')).href + '?pk=' + pk);
  await page.waitForFunction(() => window.__DONE__, null, { timeout: 60000 });
  const done = await page.evaluate(() => window.__DONE__);
  if (!done.ok) throw new Error(done.error);
  const model = await page.evaluate(() => window.__MODEL__);

  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const safe = model.name.replace(/[\\/:*?"<>|\s]+/g, '_');
  const base = path.join(outDir, `${pk}_${safe}_${day}`);
  const el = await page.$('.sg-cv');
  await el.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 90 });

  // 놀발 접힌 화면 미리보기: 폭 500 기준 240px(→원본 480px), 아래 64px(→128px) 흐림
  await page.evaluate(() => {
    const cv = document.querySelector('.sg-cv');
    const wrap = document.createElement('div');
    wrap.id = 'foldpv';
    wrap.style.cssText = 'position:relative;width:1000px;height:480px;overflow:hidden;';
    wrap.append(cv.cloneNode(true));
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:128px;background:linear-gradient(transparent,#fff);';
    wrap.append(fade);
    document.body.prepend(wrap);
  });
  await (await page.$('#foldpv')).screenshot({ path: base + '_fold.png' });
  const strip = (u) => (u && /^data:/.test(u) ? u.slice(0, 40) + '…' : u); // 사진 데이터는 json 에 넣지 않음
  fs.writeFileSync(
    base + '.json',
    JSON.stringify(
      {
        over: { ...over, uploads: (over.uploads || []).map(strip) },
        model: { ...model, hero: strip(model.hero), images: model.images.map(strip), points: model.points.map((p) => ({ ...p, image: p.image && strip(p.image) })) },
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ ok: true, file: base + '.jpg', fold: base + '_fold.png', height: done.height, name: model.name }));
} finally {
  await browser.close();
}
