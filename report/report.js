// 마케팅 결과 보고서 엔진 — NBDB "마케팅 보고서" 탭이 쓴다.
//  Report.stats(rows, from, to)  → 판매내역(DERIVED 중 이 숙소 행)으로 결제·취소·최종 건수/박수/거래액, 일별·상품별 집계
//  Report.SLOTS / slotOf(kind, 구좌) → 놀발 노출 구좌 목록(내부 int · 외부 ext)과 숫자 이름(노출·발송·조회 / 클릭·오픈)
//  Report.render(el, model)      → A4 폭(794px) 보고서 HTML (report.css 필요). 섹션마다 data-cut → PDF 쪽 나누기 위치
// 수수료·정산 등 내부 숫자는 넣지 않는다(받는 사람이 숙소 담당자).
(function (root) {
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const won = (n) => `${num(n)}원`;
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dot = (s) => { const d = dateOf(s); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}(${DOW[d.getDay()]})`; };
  const md = (s) => { const d = dateOf(s); return `${d.getMonth() + 1}.${d.getDate()}`; };

  function sum(rows) {
    return { n: rows.length, nights: rows.reduce((a, r) => a + (r.nights || 0), 0), gmv: rows.reduce((a, r) => a + (r.price || 0), 0) };
  }

  // rows: 이 숙소의 판매내역 전체(DERIVED 행). 기간은 예약 생성일 기준, from/to 는 'YYYY-MM-DD'(포함)
  function stats(rows, from, to) {
    const a = dateOf(from), b = new Date(dateOf(to).getTime() + 864e5);
    const inRange = rows.filter((r) => r.created >= a && r.created < b);
    const cancel = inRange.filter((r) => r.cancelled);
    const keep = inRange.filter((r) => !r.cancelled);
    // 일별 (예약 생성일)
    const daily = [];
    for (let d = new Date(a); d < b; d = new Date(d.getTime() + 864e5)) {
      const k = iso(d);
      const day = inRange.filter((r) => iso(r.created) === k);
      daily.push({ date: k, all: sum(day), cancel: sum(day.filter((r) => r.cancelled)) });
    }
    // 상품별
    const map = new Map();
    for (const r of inRange) {
      const k = r.product || '(상품명 없음)';
      const cur = map.get(k) || [];
      cur.push(r);
      map.set(k, cur);
    }
    const products = [...map.entries()]
      .map(([name, rs]) => ({ name, all: sum(rs), cancel: sum(rs.filter((r) => r.cancelled)), keep: sum(rs.filter((r) => !r.cancelled)) }))
      .sort((x, y) => y.all.gmv - x.all.gmv);
    // 행사 직전 같은 일수 (비교용)
    const days = Math.round((b - a) / 864e5);
    const pa = new Date(a.getTime() - days * 864e5);
    const prev = rows.filter((r) => r.created >= pa && r.created < a);
    return {
      days,
      all: sum(inRange),
      cancel: sum(cancel),
      keep: sum(keep),
      daily,
      products,
      prev: { from: iso(pa), to: iso(new Date(a.getTime() - 864e5)), all: sum(prev), keep: sum(prev.filter((r) => !r.cancelled)) },
    };
  }

  const toN = (s) => { const v = String(s == null ? '' : s).replace(/[^\d.]/g, ''); return v ? Number(v) : null; };

  // 노출 구좌 (놀발_노출구좌소개 기준). label = 보고서에 쓰는 이름, imp/clk = 그 구좌의 숫자 이름
  const SLOTS = {
    int: [
      { label: '메인화면 · 메인배너(빅배너)', imp: '노출', clk: '클릭' },
      { label: '메인화면 · 퀵메뉴', imp: '노출', clk: '클릭' },
      { label: '메인화면 · 띠배너', imp: '노출', clk: '클릭' },
      { label: '메인화면 · 타임특가', imp: '노출', clk: '클릭' },
      { label: '메인화면 · 아이가 좋아해요', imp: '노출', clk: '클릭' },
      { label: '메인화면 · 실시간 랭킹', imp: '노출', clk: '클릭' },
      { label: '앱 팝업', imp: '노출', clk: '클릭' },
      { label: '퀵메뉴(숙박) · 특가', imp: '노출', clk: '클릭' },
      { label: '퀵메뉴(숙박) · 인기베스트', imp: '노출', clk: '클릭' },
      { label: '퀵메뉴(레저) · 특가', imp: '노출', clk: '클릭' },
      { label: '퀵메뉴(레저) · 키즈테마파크', imp: '노출', clk: '클릭' },
      { label: '기획전 페이지', imp: '노출', clk: '클릭' },
      { label: '상품상세 배너', imp: '노출', clk: '클릭' },
      { label: '앱푸시', imp: '발송', clk: '오픈' },
    ],
    ext: [
      { label: '네이버 파워링크 광고', imp: '노출', clk: '클릭' },
      { label: '네이버 지식쇼핑 광고', imp: '노출', clk: '클릭' },
      { label: '공동구매 (인스타그램)', imp: '조회', clk: '클릭' },
      { label: '유튜버 (또떠남)', imp: '조회', clk: '클릭' },
      { label: '맘카페 바이럴', imp: '조회', clk: '클릭' },
      { label: '메타 광고', imp: '노출', clk: '클릭' },
      { label: '웅진북클럽 라운지톡', imp: '발송', clk: '클릭' },
      { label: '네이버 블로그', imp: '조회', clk: '클릭' },
    ],
  };
  const slotOf = (kind, ch) => SLOTS[kind].find((s) => s.label === ch) || { label: ch, imp: kind === 'ext' ? '조회' : '노출', clk: '클릭' };

  // 일별 거래액 막대 (결제 전체 = 진한색, 그중 취소 = 회색)
  function chart(daily) {
    const W = 698, H = 240, padL = 8, padB = 34, padT = 26;
    const max = Math.max(1, ...daily.map((d) => d.all.gmv));
    const bw = (W - padL * 2) / daily.length;
    const gap = Math.min(10, bw * 0.28);
    const every = Math.ceil(daily.length / 14); // 날짜 라벨은 최대 14개
    const bars = daily
      .map((d, i) => {
        const x = padL + i * bw + gap / 2, w = bw - gap;
        const h = ((H - padB - padT) * d.all.gmv) / max;
        const hc = ((H - padB - padT) * d.cancel.gmv) / max;
        const y = H - padB - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#FF2D55"/>`
          + (hc > 0 ? `<rect x="${x.toFixed(1)}" y="${(H - padB - hc).toFixed(1)}" width="${w.toFixed(1)}" height="${hc.toFixed(1)}" fill="#C9CCD5"/>` : '')
          + (d.all.n && daily.length <= 16 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" class="v">${d.all.n}건</text>` : '')
          + (i % every === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="l">${md(d.date)}</text>` : '');
      })
      .join('');
    return `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="일별 결제 거래액">
      <line x1="${padL}" x2="${W - padL}" y1="${H - padB}" y2="${H - padB}" stroke="#E2E4EA"/>${bars}</svg>`;
  }

  const delta = (cur, prev) => {
    if (!prev) return '<span class="dl">-</span>';
    const r = ((cur - prev) / prev) * 100;
    return `<span class="dl ${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '▲' : '▼'} ${Math.abs(r).toFixed(0)}%</span>`;
  };

  function render(el, m) {
    const s = m.stats;
    const h = [];
    h.push(`<div class="rp-cv">`);
    // 표지 + 요약
    h.push(`<section class="rp-cover" data-cut>
      ${m.hero ? `<div class="rp-hero"><img src="${esc(m.hero)}" alt=""></div>` : ''}
      <div class="rp-cover-t">
        <p class="rp-eyebrow">MARKETING REPORT</p>
        <h1>${esc(m.name)}</h1>
        <p class="rp-sub">${esc(m.title)}</p>
        <dl class="rp-meta">
          <div><dt>프로모션</dt><dd>${esc(m.type || '-')}${m.product ? ` · ${esc(m.product)}` : ''}</dd></div>
          <div><dt>진행 기간</dt><dd>${dot(m.from)} ~ ${dot(m.to)} (${s.days}일)</dd></div>
          ${m.to2 ? `<div><dt>받는 분</dt><dd>${esc(m.to2)}</dd></div>` : ''}
          <div><dt>작성</dt><dd>놀이의발견${m.md ? ` ${esc(m.md)}` : ''} · ${dot(m.today)}</dd></div>
        </dl>
      </div>
    </section>`);

    // 판매 성과
    const row = (label, x, cls) => `<tr class="${cls || ''}"><th>${label}</th><td>${num(x.n)}건</td><td>${num(x.nights)}박</td><td>${won(x.gmv)}</td></tr>`;
    h.push(`<section class="rp-sec" data-cut>
      <h2><span>01</span>판매 성과</h2>
      <div class="rp-kpis">
        <div><small>최종 예약</small><b>${num(s.keep.n)}<i>건</i></b></div>
        <div><small>최종 박수</small><b>${num(s.keep.nights)}<i>박</i></b></div>
        <div class="wide"><small>최종 거래액</small><b>${num(s.keep.gmv)}<i>원</i></b></div>
      </div>
      <table class="rp-tbl rp-sum">
        <thead><tr><th></th><th>건수</th><th>박수</th><th>거래액</th></tr></thead>
        <tbody>${row('결제 전체', s.all)}${row('취소', s.cancel, 'cx')}${row('최종 (취소 제외)', s.keep, 'fin')}</tbody>
      </table>
      <p class="rp-note">취소율 ${pct(s.cancel.n, s.all.n)} (건수 기준) · 집계 기준: 예약 생성일이 진행 기간 안인 예약, ${dot(m.today)} 현재 예약 상태</p>
    </section>
    <section class="rp-cmp-wrap" data-cut>
      <div class="rp-cmp">
        <p>행사 직전 같은 기간 (${dot(s.prev.from)} ~ ${dot(s.prev.to)}) 대비</p>
        <div><span>최종 예약</span><b>${num(s.prev.keep.n)}건 → ${num(s.keep.n)}건</b>${delta(s.keep.n, s.prev.keep.n)}</div>
        <div><span>최종 거래액</span><b>${won(s.prev.keep.gmv)} → ${won(s.keep.gmv)}</b>${delta(s.keep.gmv, s.prev.keep.gmv)}</div>
      </div>
    </section>`);

    if (s.daily.length > 1) {
      h.push(`<section class="rp-sec" data-cut>
        <h3>일별 결제 거래액</h3>${chart(s.daily)}
        <p class="rp-legend"><i class="a"></i>결제 거래액 <i class="c"></i>그중 취소</p>
      </section>`);
    }

    if (s.products.length) {
      const top = s.products.slice(0, 12);
      h.push(`<section class="rp-sec" data-cut>
        <h3>상품별 판매</h3>
        <table class="rp-tbl rp-prod">
          <thead><tr><th>상품</th><th>결제</th><th>취소</th><th>최종</th><th>최종 박수</th><th>최종 거래액</th></tr></thead>
          <tbody>${top.map((p) => `<tr><th>${esc(p.name)}</th><td>${num(p.all.n)}</td><td>${num(p.cancel.n)}</td><td>${num(p.keep.n)}</td><td>${num(p.keep.nights)}</td><td>${won(p.keep.gmv)}</td></tr>`).join('')}</tbody>
        </table>
        ${s.products.length > top.length ? `<p class="rp-note">결제 거래액 상위 ${top.length}개 상품 (전체 ${s.products.length}개)</p>` : ''}
      </section>`);
    }

    // 내부·외부 마케팅: 요약 표 + 구좌마다 캡처 이미지와 성과 카드
    const mkSection = (kind, no, title, sub, items) => {
      const imp = items.reduce((a, x) => a + (toN(x.imp) || 0), 0);
      const clk = items.reduce((a, x) => a + (toN(x.clk) || 0), 0);
      h.push(`<section class="rp-sec" data-cut>
        <h2><span>${no}</span>${title} <small>${sub}</small></h2>
        ${items.length ? `<div class="rp-kpis">
          <div><small>진행 구좌</small><b>${items.length}<i>개</i></b></div>
          <div><small>총 ${kind === 'ext' ? '노출·조회' : '노출·발송'}</small><b>${num(imp)}<i>회</i></b></div>
          <div><small>총 클릭·오픈</small><b>${num(clk)}<i>회</i></b></div>
          <div><small>클릭률</small><b>${imp && clk ? ((clk / imp) * 100).toFixed(2) : '-'}<i>%</i></b></div>
        </div>
        <table class="rp-tbl rp-mk">
          <thead><tr><th>구좌</th><th>내용</th><th>기간</th><th>노출·조회</th><th>클릭·오픈</th><th>클릭률</th></tr></thead>
          <tbody>${items.map((x) => { const i = toN(x.imp), c = toN(x.clk); return `<tr><th>${esc(x.ch)}</th><td class="t">${esc(x.title)}</td><td>${esc(x.period)}</td><td>${i != null ? num(i) : '-'}</td><td>${c != null ? num(c) : '-'}</td><td>${i && c != null ? pct(c, i) : '-'}</td></tr>`; }).join('')}</tbody>
        </table>` : `<p class="rp-empty">이번 프로모션 기간에 진행한 ${title} 내역이 없습니다.</p>`}
      </section>`);
      items.forEach((x) => {
        const s = slotOf(kind, x.ch), i = toN(x.imp), c = toN(x.clk);
        h.push(`<section class="rp-card" data-cut>
          ${x.img ? `<div class="rp-shot"><img src="${esc(x.img)}" alt=""></div>` : ''}
          <div class="rp-card-t">
            <p class="rp-slot">${esc(x.ch)}</p>
            <h4>${esc(x.title || x.ch)}</h4>
            ${x.period ? `<p class="rp-when">${esc(x.period)}</p>` : ''}
            <div class="rp-mets">
              ${i != null ? `<div><small>${s.imp}</small><b>${num(i)}</b></div>` : ''}
              ${c != null ? `<div><small>${s.clk}</small><b>${num(c)}</b></div>` : ''}
              ${i && c != null ? `<div><small>${s.clk}률</small><b>${pct(c, i)}</b></div>` : ''}
              ${x.react ? `<div class="w"><small>반응</small><b>${esc(x.react)}</b></div>` : ''}
            </div>
            ${x.memo ? `<p class="rp-memo">${esc(x.memo)}</p>` : ''}
            ${x.link ? `<p class="rp-link">${esc(x.link)}</p>` : ''}
          </div>
        </section>`);
      });
    };
    mkSection('int', '02', '내부 마케팅', '놀이의발견 앱·웹 노출', m.internal);
    mkSection('ext', '03', '외부 마케팅', '광고·SNS·바이럴·제휴', m.external);

    if (m.comment) {
      h.push(`<section class="rp-sec" data-cut><h3>담당 MD 의견</h3><div class="rp-comment">${esc(m.comment)}</div></section>`);
    }
    h.push(`<p class="rp-foot">본 보고서는 놀이의발견 판매·노출 데이터를 바탕으로 작성되었습니다. 거래액은 결제 금액 기준이며, 이후 취소·변경에 따라 달라질 수 있습니다.</p>`);
    h.push(`</div>`);
    el.innerHTML = h.join('');
    return el.firstElementChild;
  }

  // PDF 쪽 나누기: 섹션 경계에서 한 쪽 높이(max)를 넘지 않게. 한 섹션이 max 보다 길면 그 섹션은 잘라서 넘긴다
  function pages(cv, max) {
    const top = cv.getBoundingClientRect().top;
    const marks = [...cv.querySelectorAll('[data-cut]')].map((s) => Math.round(s.getBoundingClientRect().top - top));
    const end = cv.offsetHeight;
    const out = [];
    let start = 0;
    for (const y of [...marks.slice(1), end]) {
      while (y - start > max) {
        // 이 섹션 시작 전에서 끊을 수 있으면 거기서, 아니면 max 에서
        const prevMark = marks.filter((x) => x > start && x <= start + max).pop();
        const cut = prevMark && prevMark > start ? prevMark : start + max;
        out.push([start, cut]);
        start = cut;
      }
    }
    if (end > start) out.push([start, end]);
    return out;
  }

  root.Report = { stats, render, pages, dot, SLOTS, slotOf };
})(typeof window !== 'undefined' ? window : globalThis);
