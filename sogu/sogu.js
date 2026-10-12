// 특가 소구 이미지 엔진 — NBDB "특가 소구 이미지" 탭과 자동 생성 스크립트(sogu/make.mjs)가 함께 쓴다.
//  Sogu.load(pk)            → 놀발 숙소 데이터(+프로모션 일정) 가져오기
//  Sogu.build(data, over)   → 자동 소구포인트/문구 + 사용자 입력(over)을 합친 모델
//  Sogu.render(el, model)   → 1000px 폭 이미지용 HTML 그리기 (sogu.css 필요)
// 원칙: 문구는 놀발 데이터에 있는 사실로만 만든다(시설 설명을 지어내지 않음). 과장 표현(최저가/역대급) 금지.
(function (root) {
  const API = 'https://price-scraper-iota.vercel.app/api';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // **강조** → 노란 글씨
  const mark = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');
  const won = (n) => Number(n).toLocaleString('ko-KR');
  const cleanName = (s) => String(s || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
  const md = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00+09:00');
    return `${d.getMonth() + 1}.${d.getDate()}(${DOW[d.getDay()]})`;
  };
  const shortPrice = (n) => (n >= 10000 ? `${Math.floor(n / 10000)}만원대` : `${won(n)}원`);
  const season = (m) => (m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울');
  const nightsOf = (tag) => {
    const m = String(tag || '').match(/(\d)\s*박/);
    return m ? +m[1] : 1;
  };

  // 시설/테마 → 아이콘
  const ICON = [
    [/워터|수영|풀|물놀이|스파|온천|사우나/, '🌊'],
    [/미취학|유아|아동|소인/, '👶'],
    [/키즈|놀이|아이|어린이|티니핑|캐릭터/, '🧸'],
    [/바베큐|BBQ|그릴/i, '🍖'],
    [/조식|뷔페|식당|레스토랑|올인클루시브/, '🍳'],
    [/오션|바다|해변|비치/, '🏖️'],
    [/골프/, '⛳'],
    [/스키|썰매|눈/, '⛷️'],
    [/카페|베이커리/, '☕'],
    [/편의점|마트/, '🛒'],
    [/주차/, '🅿️'],
    [/반려|펫/, '🐶'],
  ];
  const iconOf = (s, d = '✨') => (ICON.find(([re]) => re.test(s)) || [null, d])[1];

  // 놀발 CDN은 CORS 허용 → 그대로, 나머지(공급사 이미지 서버 등)는 price-scraper 중계로
  const viaProxy = (u) => (!u || /^data:/.test(u) || /^https:\/\/cdn\.nolbal\.com\//.test(u) ? u : `${API}/img?url=${encodeURIComponent(u)}`);

  async function getJSON(url) {
    const r = await fetch(url);
    return r.json();
  }

  async function load(pk) {
    pk = String(pk || '').trim();
    if (!/^\d+$/.test(pk)) throw new Error('PK 번호(숫자)를 입력하세요.');
    const [d, promo] = await Promise.all([
      getJSON(`${API}/stay-detail?id=${pk}&days=92`),
      getJSON(`${API}/promotions`).catch(() => null),
    ]);
    if (!d.ok) throw new Error(d.error || '숙소 정보를 불러오지 못했어요.');
    // 프로모션 관리 DB에서 같은 PK의 일정(오늘 진행 중 → 가장 가까운 예정 순)
    let promotion = null;
    const items = (promo && promo.items) || [];
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const mine = items
      .filter((x) => String(x.pk || '').trim() === pk && x.end && x.end >= today && !/불가|취소/.test(x.confirm || ''))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    promotion = mine.find((x) => x.start <= today) || mine[0] || null;
    return { ...d, promotion, pk };
  }

  // 판매 상품명 머리말([추캉스 올인클루시브 1박_10월])별 최저가 = 패키지
  function packagesOf(sales) {
    const map = new Map();
    for (const p of (sales && sales.products) || []) {
      const tag = (p.tag || '기본 객실').replace(/★/g, ' ').replace(/\s+/g, ' ').trim();
      if (nightsOf(tag) !== 1) continue; // 2박 이상 상품은 1박 가격과 비교가 안 돼서 뺀다
      const cur = map.get(tag) || { tag, price: null, rooms: new Set() };
      if (cur.price == null || p.minPrice < cur.price) cur.price = p.minPrice;
      cur.rooms.add(p.room);
      map.set(tag, cur);
    }
    return [...map.values()]
      .map((x) => ({ tag: x.tag, price: x.price, rooms: [...x.rooms] }))
      .sort((a, b) => a.price - b.price);
  }

  // 데이터 → 자동 소구포인트 후보 (사실만)
  function autoPoints(data, pkgs) {
    const d = data.detail;
    const pts = [];
    const sec = (re) => (d.facilitySections || []).find((s) => re.test(s.title || ''));
    const kids = sec(/아이/);
    const fam = sec(/가족|모두/);
    const kidItems = kids ? kids.items : [];
    if (kidItems.length) {
      pts.push({
        key: 'kids',
        icon: iconOf(kidItems.join(' '), '🧸'),
        chip: `${kidItems[0]}`,
        title: `아이와 함께 즐기는 ${kidItems.join(' · ')}`,
        desc: `숙소 안 '아이와 함께 하는 시설'로 ${kidItems.join(', ')}이(가) 있어요.`,
      });
    }
    const themes = (d.themes || []).filter((t) => !kidItems.includes(t));
    if (themes.length) {
      pts.push({
        key: 'theme',
        icon: iconOf(themes.join(' ')),
        chip: themes[0],
        title: `${themes.join(' · ')} 테마 숙소`,
        desc: `놀이의발견 테마 분류: ${themes.join(', ')}`,
      });
    }
    // 인원 추가 무료 조건
    // '무료' 조건 + 그 줄이 속한 안내 제목([인원 추가 요금], 📢 조식 안내 …)을 함께 — 맥락 없이 쓰면 오해 소지
    let head = '';
    let freeLine = null;
    let freeHead = '';
    for (const raw of (d.extraChargeInfo || '').split('\n')) {
      const l = raw.replace(/^[-*•✅\s]+/, '').trim();
      if (!l) continue;
      const hm = l.match(/^\[(.+)\]$/) || (/(안내|요금|정보)\s*$/.test(l) && !/\d+\s*원/.test(l) ? [l, l] : null);
      if (hm) {
        head = hm[1].replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s*(안내|요금|정보)\s*$/, '').trim();
        continue;
      }
      if (!freeLine && /무료/.test(l)) {
        freeLine = l;
        freeHead = head;
      }
    }
    if (freeLine) {
      const isPeople = !freeHead || /인원/.test(freeHead);
      const title = isPeople ? freeLine : `${freeHead} ${freeLine}`;
      pts.push({
        key: 'free',
        icon: isPeople ? '👶' : iconOf(freeHead, '🎁'),
        chip: title.length <= 12 ? title : isPeople ? '아이 추가 무료' : `${freeHead} 아이 무료`,
        title,
        desc: isPeople ? '인원 추가 요금 안내 기준이에요. (기준·최대 인원은 객실마다 달라요)' : `숙소 추가요금 안내의 '${freeHead}' 항목 기준이에요.`,
      });
    }
    const pkgHi = pkgs.find((p) => /올인|조식|뷔페|패키지|워터|키즈|입장/.test(p.tag));
    if (pkgHi) {
      pts.push({
        key: 'package',
        icon: iconOf(pkgHi.tag, '🎁'),
        chip: '혜택 패키지',
        title: /패키지/.test(pkgHi.tag) ? pkgHi.tag : `${pkgHi.tag} 패키지`,
        desc: `${pkgHi.rooms.length}개 객실 타입 · 1박 ${won(pkgHi.price)}원부터`,
      });
    }
    const rv = d.reviews || {};
    if (rv.rating >= 4.3 && rv.count >= 3) {
      pts.push({
        key: 'review',
        icon: '⭐',
        chip: `평점 ${rv.rating}`,
        title: `실제 투숙객 평점 ${rv.rating}점`,
        desc: `놀이의발견 후기 ${rv.count}개 기준` + ((rv.ratings || []).length ? ` · ${(rv.ratings || []).map((r) => `${r.name} ${r.rating}`).join(' / ')}` : ''),
      });
    }
    const famItems = fam ? fam.items.filter((x) => !/와이파이|wifi/i.test(x)) : (d.facilities || []).filter((x) => !kidItems.includes(x));
    if (famItems.length) {
      pts.push({
        key: 'facility',
        icon: iconOf(famItems.join(' '), '🏨'),
        chip: famItems[0],
        title: `${famItems.slice(0, 4).join(' · ')}까지 숙소 안에서`,
        desc: `가족 모두 이용할 수 있는 시설: ${famItems.join(', ')}`,
      });
    }
    const roomNames = [...new Set(((data.sales && data.sales.products) || []).map((p) => p.room))];
    if (roomNames.length >= 4) {
      pts.push({
        key: 'rooms',
        icon: '🛏️',
        chip: `객실 ${roomNames.length}타입`,
        title: `골라 묵는 객실 ${roomNames.length}가지 타입`,
        desc: roomNames.slice(0, 5).join(' · ') + (roomNames.length > 5 ? ' 외' : ''),
      });
    }
    return pts;
  }

  // 자동 문구 + 사용자 입력 합치기
  function build(data, over) {
    over = over || {};
    const d = data.detail;
    const sales = data.sales || {};
    const pkgs = packagesOf(sales);
    const name = cleanName(d.name);
    const region = d.region || '';
    const city = region.split(' ').pop() || region;
    const now = new Date(Date.now() + 9 * 3600e3);
    const minPrice = pkgs.length ? pkgs[0].price : sales.minPrice || null;

    const auto = autoPoints(data, pkgs);
    const hidden = new Set(over.hide || []);
    const autoUse = auto.filter((p) => !hidden.has(p.key));
    const stars = (over.stars || []).filter((s) => s && s.title).map((s, i) => ({ ...s, key: 'star' + i, star: true, icon: s.icon || '🔥' }));
    // 포인트별 사진 지정: 강조 포인트의 imageIndex 또는 over.pointImages[key] (사진 번호, 'none'=사진 없음)
    const pim = over.pointImages || {};
    const pick = (i) => (i === 'none' ? 'none' : i != null && i !== '' && (d.images || [])[+i] ? d.images[+i] : null);
    const points = [...stars, ...autoUse].map((p) => {
      const img = pick(p.imageIndex != null ? p.imageIndex : pim[p.key]);
      return img ? { ...p, image: img } : p;
    });

    // 첫 화면 훅
    const kid = auto.find((p) => p.key === 'kids');
    const feature = stars.length
      ? stars[0].hook || stars[0].title
      : kid
        ? `${(d.facilitySections.find((s) => /아이/.test(s.title)) || {}).items?.[0] || ''} 품은 ${d.type || '숙소'}`
        : `${(d.themes || [])[0] ? d.themes[0] + ' ' : ''}${d.type || '숙소'}`;
    const hook1 = over.hook1 != null && over.hook1 !== '' ? over.hook1 : `${city} ${season(now.getMonth() + 1)}여행,`;
    const hook2 =
      over.hook2 != null && over.hook2 !== ''
        ? over.hook2
        : minPrice
          ? `${feature} **1박 ${shortPrice(minPrice)}**`
          : stars.length
            ? `**${feature}**`
            : `놀발에서만 만나는 **${d.type || '숙소'} 특가**`;

    const promo = data.promotion;
    const due = over.due != null ? over.due : promo && promo.end ? `${md(promo.end)}까지 특가` : '';
    const stayFrom = sales.firstOpen;
    const stayTo = sales.lastOpen;
    const stay =
      over.stay != null
        ? over.stay
        : stayFrom
          ? `투숙 ${md(stayFrom)} ~ ${stayTo && stayTo < sales.to ? md(stayTo) : ''}`.trim()
          : '';

    const images = d.images || [];
    const heroIdx = Math.min(Math.max(+over.heroIndex || 0, 0), Math.max(images.length - 1, 0));
    const hero = over.heroImage || images[heroIdx] || '';
    const rest = images.filter((_, i) => i !== heroIdx);

    const chips = (over.chips && over.chips.length ? over.chips : points.slice(0, 3).map((p) => ({ icon: p.star ? iconOf(p.title, '🔥') : p.icon, label: (p.chip || p.title).replace(/\*\*/g, '') })))
      .slice(0, 3)
      .map((c) => (typeof c === 'string' ? { icon: iconOf(c), label: c } : c));

    // 후기: 별 5개 + 20자 이상, 글자 수 적당한 것 3개 (작성자 이름은 쓰지 않음)
    const quotes = ((d.reviews && d.reviews.items) || [])
      .filter((r) => r.rating >= 4.5 && r.text && r.text.replace(/\s/g, '').length >= 15)
      .map((r) => ({ text: r.text.replace(/\s+/g, ' ').trim(), room: r.room }))
      .sort((a, b) => Math.abs(a.text.length - 60) - Math.abs(b.text.length - 60))
      .slice(0, 3);

    // 추가요금 안내: [머리말]과 함께, 인원·조식·주차·체크인 관련 줄과 '무료' 조건만
    const infos = [];
    let head = '';
    for (const raw of (d.extraChargeInfo || '').split('\n')) {
      const l = raw.trim();
      const hm = l.match(/^\[(.+)\]$/);
      if (hm) {
        head = hm[1].replace(/\s*요금$/, '');
        continue;
      }
      const t = l.replace(/^[-*•\s]+/, '').trim();
      if (!t || /^※/.test(t)) continue;
      if (/인원|조식|주차|체크|반려|취사/.test(head) || /무료/.test(t)) infos.push(head ? `${head}: ${t}` : t);
    }
    infos.splice(5);

    const listPrice = over.listPrice ? +String(over.listPrice).replace(/[^\d]/g, '') : null;
    return {
      pk: data.pk,
      url: data.url,
      name,
      region,
      type: d.type,
      badge: over.badge || '놀발 단독 특가',
      due,
      stay,
      hook1,
      hook2,
      hero,
      images: rest,
      chips,
      points: points.slice(0, over.maxPoints || 6),
      autoPoints: auto,
      price: minPrice,
      priceText: over.priceText || '',
      listPrice: listPrice && minPrice && listPrice > minPrice ? listPrice : null,
      packages: pkgs.slice(0, 4),
      infos: over.infos || infos,
      reviews: { rating: d.reviews && d.reviews.rating, count: d.reviews && d.reviews.count, quotes },
      cta: over.cta || '아래에서 객실을 골라보세요',
      promotion: promo,
    };
  }

  function render(el, m) {
    const pct = m.listPrice ? Math.round((1 - m.price / m.listPrice) * 100) : null;
    const imgAt = (i) => viaProxy(m.images.length ? m.images[i % m.images.length] : m.hero);
    const stars = (r) => '★★★★★'.slice(0, Math.round(r || 0)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r || 0));
    const h = [];
    h.push(`<div class="sg-cv">`);
    // HERO — 위 350px(접힌 화면)에 배지·마감·훅 2줄·숙소명
    h.push(`<section class="sg-hero">${m.hero ? `<img src="${esc(viaProxy(m.hero))}" crossorigin="anonymous" alt="">` : ''}
      <div class="sg-hero-in">
        <div class="sg-top"><span class="sg-badge">${esc(m.badge)}</span>${m.due ? `<span class="sg-due">⏰ ${esc(m.due)}</span>` : ''}</div>
        <p class="sg-h1 sg-fit">${mark(m.hook1)}</p>
        <p class="sg-h2 sg-fit">${mark(m.hook2)}</p>
        <div class="sg-name"><b>${esc(m.name)}</b>${m.region ? `<span>${esc(m.region)}</span>` : ''}</div>
      </div>
      ${m.chips.length ? `<div class="sg-chips">${m.chips.map((c) => `<div class="sg-chip"><i>${esc(c.icon || '✨')}</i><b>${esc(c.label)}</b></div>`).join('')}</div>` : ''}
    </section>`);
    // PRICE
    if (m.price || m.priceText) {
      h.push(`<section class="sg-price"><span class="lbl">놀이의발견 특가</span>
        <div class="row">${m.listPrice ? `<span class="old">${won(m.listPrice)}원</span><span class="pct">${pct}%</span>` : ''}
        <span class="now">${m.priceText ? esc(m.priceText) : `${won(m.price)}<small>원~</small>`}</span></div>
        <p class="note">1박 · 객실 1개 기준 판매가 중 최저가 (날짜·객실별 요금 상이)</p>
        ${m.stay || m.due ? `<div class="stay">${m.due ? `<span>🗓️ 판매 ${esc(m.due.replace(/\s*특가$/, ''))}</span>` : ''}${m.stay ? `<span>🛏️ ${esc(m.stay)}</span>` : ''}</div>` : ''}
      </section>`);
    }
    // POINTS
    if (m.points.length) {
      h.push(`<section class="sg-sec"><div class="sg-sec-h"><small>WHY HERE</small><h3>${esc(m.name)},<br>여기라서 좋은 이유</h3></div>`);
      m.points.forEach((p, i) => {
        const img = p.image && p.image !== 'none' ? viaProxy(p.image) : p.image || imgAt(i);
        h.push(`<div class="sg-pt${p.star ? ' star' : ''}">${p.star ? '<span class="sg-pick">놀발 PICK</span>' : ''}
          <div class="sg-pt-head"><span class="sg-pt-no">${String(i + 1).padStart(2, '0')}</span>
          <div><p class="sg-pt-t">${esc(p.icon ? p.icon + ' ' : '')}${mark(p.title)}</p>${p.desc ? `<p class="sg-pt-d">${mark(p.desc)}</p>` : ''}</div></div>
          ${img && p.image !== 'none' ? `<img src="${esc(img)}" crossorigin="anonymous" alt="">` : ''}</div>`);
      });
      h.push(`</section>`);
    }
    // PACKAGES
    if (m.packages.length > 1) {
      h.push(`<section class="sg-sec"><div class="sg-sec-h"><small>PACKAGE</small><h3>지금 판매 중인 상품</h3></div><div class="sg-pk">`);
      m.packages.forEach((p, i) => {
        h.push(`<div class="sg-pk-i"><div><small>PACKAGE ${i + 1}</small><b>${esc(p.tag)}</b><p>${esc(p.rooms.slice(0, 3).join(' · '))}${p.rooms.length > 3 ? ` 외 ${p.rooms.length - 3}개` : ''}</p></div>
          <div class="pr">${won(p.price)}<small>원~</small></div></div>`);
      });
      h.push(`</div></section>`);
    }
    // INFO
    if (m.infos.length) {
      h.push(`<section class="sg-sec"><div class="sg-sec-h"><small>CHECK</small><h3>예약 전 확인하세요</h3></div><ul class="sg-info">${m.infos.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`);
    }
    // REVIEWS
    if (m.reviews.rating && m.reviews.count >= 3) {
      h.push(`<section class="sg-sec"><div class="sg-sec-h"><small>REVIEW</small><h3>먼저 다녀온 분들 이야기</h3></div>
        <div class="sg-rv-score"><span class="stars">${stars(m.reviews.rating)}</span><b>${m.reviews.rating}</b>놀이의발견 후기 ${m.reviews.count}개</div>
        ${m.reviews.quotes.length ? `<div class="sg-rv-list">${m.reviews.quotes.map((q) => `<div class="sg-rv">${esc(q.text)}${q.room ? `<small>${esc(q.room)} 투숙</small>` : ''}</div>`).join('')}</div>` : ''}
      </section>`);
    }
    h.push(`<section class="sg-cta"><h3>${mark(m.cta)}</h3>${m.due ? `<p>${esc(m.due)} · 놓치면 이 가격 다시 없어요</p>` : ''}<div class="arrow">👇</div></section>`);
    h.push(`<p class="sg-foot">* 가격은 제작 시점(${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}) 놀이의발견 판매가 기준이며 날짜·객실·재고에 따라 달라질 수 있어요. 사진은 이해를 돕기 위한 이미지예요.</p>`);
    h.push(`</div>`);
    el.innerHTML = h.join('');
    fit(el);
    return el.firstElementChild;
  }

  // 한 줄 문구가 폭을 넘으면 글자 크기를 줄인다
  function fit(el) {
    el.querySelectorAll('.sg-fit').forEach((p) => {
      p.style.fontSize = '';
      let size = parseFloat(getComputedStyle(p).fontSize);
      const max = 920;
      let guard = 60;
      while (p.scrollWidth > max && size > 28 && guard--) {
        size -= 2;
        p.style.fontSize = size + 'px';
      }
    });
    el.querySelectorAll('.sg-name').forEach((n) => {
      const b = n.querySelector('b');
      let size = 36;
      let guard = 20;
      while (n.scrollWidth > n.clientWidth + 1 && size > 24 && guard--) {
        size -= 2;
        b.style.fontSize = size + 'px';
      }
    });
  }

  // 이미지가 다 로드될 때까지 (폰트 포함).
  //  - 그래도 못 읽은 이미지는 지운다(저장이 통째로 실패하지 않게) → 반환값 failed 에 주소
  //  - 큰 원본은 폭 1000px JPEG 로 줄여 넣는다(저장 파일·변환 메모리 절약)
  async function ready(el) {
    const imgs = [...el.querySelectorAll('img')];
    await Promise.all(
      imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })))
    );
    const failed = [];
    for (const i of imgs) {
      if (!i.naturalWidth) {
        failed.push(i.src);
        i.remove();
        continue;
      }
      if (/^data:/.test(i.src) || i.naturalWidth <= 1000) continue;
      try {
        const w = 1000;
        const h = Math.round((i.naturalHeight * w) / i.naturalWidth);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(i, 0, 0, w, h);
        const url = c.toDataURL('image/jpeg', 0.9);
        await new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); i.src = url; });
      } catch (_) {
        /* 줄이기 실패하면 원본 그대로 */
      }
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    fit(el);
    return { failed };
  }

  // "제목 | 설명" 줄 → 강조 포인트
  function parseStars(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [title, ...rest] = l.split('|');
        return { title: title.trim(), desc: rest.join('|').trim() };
      });
  }

  root.Sogu = { API, load, build, render, ready, fit, parseStars, packagesOf, autoPoints, md, won };
})(typeof window !== 'undefined' ? window : globalThis);
