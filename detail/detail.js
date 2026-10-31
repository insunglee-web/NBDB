// 스마트스토어 상세페이지 엔진 — NBDB "상세페이지" 탭이 쓴다.
//  데이터는 소구 이미지와 같은 Sogu.load(pk) (price-scraper /api/stay-detail) 를 그대로 쓴다.
//  Detail.build(data, over)  → 숙소 소개·상품·객실·부대시설·이용안내·취소규정을 담은 모델
//  Detail.render(el, model)  → 860px 폭 상세페이지 HTML (detail.css 필요)
// 원칙: 문구는 놀발 데이터에 있는 사실로만 만든다(시설 설명을 지어내지 않음). 과장 표현 금지.
(function (root) {
  const API = 'https://price-scraper-iota.vercel.app/api';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // **강조** → 강조색
  const mark = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');
  const won = (n) => Number(n).toLocaleString('ko-KR');
  const cleanName = (s) => String(s || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
  const ymdDot = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00+09:00');
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}(${DOW[d.getDay()]})`;
  };
  // 놀발 CDN 은 CORS 허용 → 그대로, 나머지(공급사 이미지 서버 등)는 price-scraper 중계로 (sogu.js 와 같음)
  const viaProxy = (u) => (!u || /^data:/.test(u) || /^https:\/\/cdn\.nolbal\.com\//.test(u) || u.startsWith(API + '/sogu?') ? u : `${API}/img?url=${encodeURIComponent(u)}`);

  // 놀발 안내 문구 → [제목] 단위 블록. 제목 없는 앞부분은 title=null
  function blocks(text, src) {
    const out = [];
    let cur = { title: null, lines: [] };
    const push = () => { if (cur.lines.length) out.push(cur); };
    for (const raw of String(text || '').split('\n')) {
      const l = raw.replace(/\t+/g, ' ').replace(/\s+$/, '').trim();
      const m = l.match(/^[[【]\s*(.+?)\s*[\]】]$/);
      if (m) {
        push();
        cur = { title: m[1], lines: [] };
      } else if (l) cur.lines.push(l);
    }
    push();
    return out.map((b, i) => ({ ...b, key: `${src}${i}` }));
  }
  const isCancel = (b) => /취소|환불/.test(b.title || '');
  const isContact = (b) => /고객센터|문의|연락처/.test(b.title || '');

  // 놀이의발견 고객센터 (nolbal.com 하단 사업자 정보 기준)
  const NOLBAL_CS = '1566-0286';
  const NOLBAL_CS_HOURS = '오전 10:00 ~ 19:00 / 연중무휴';

  // "5, 6, 내1" → ['5','6','내1'] · '없음' → []   (내N = 직접 올린 사진 N)
  const PHOTO = /^(\d+|내\d+)$/;
  const photoNos = (s) => (/^(없음|none)$/.test(String(s).trim()) ? [] : String(s).replace(/내\s+(\d)/g, '내$1').split(/[,\s]+/).filter((x) => PHOTO.test(x)));

  // "제목 | 설명 | 사진번호" 줄 → 카드 (사진번호: 숫자 여러 개 "5, 6" 가능 · '없음')
  function parseCards(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split('|').map((s) => s.trim());
        let img;
        if (parts.length >= 2 && /^((\d+|내\s*\d+)(\s*,\s*(\d+|내\s*\d+))*|없음|none)$/.test(parts[parts.length - 1])) img = photoNos(parts.pop());
        return { title: parts[0], desc: parts.slice(1).join(' | ').replace(/\s*\/\s*/g, '\n'), img };
      });
  }

  // 객실 정보(놀발 admin) → 카드 기본값
  function autoRooms(data) {
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    return rooms
      .filter((r) => r.name)
      .map((r) => {
        const desc = [];
        if (r.standard || r.max) desc.push(`투숙 인원: ${[r.standard ? `기준 ${r.standard}인` : '', r.max ? `최대 ${r.max}인` : ''].filter(Boolean).join(' / ')}`);
        if (r.bed) desc.push(`침대: ${r.bed}`);
        if (r.size) desc.push(`면적: ${r.size}${/\d$/.test(String(r.size)) ? '㎡' : ''}`);
        return { title: cleanName(r.name), desc: desc.join('\n'), images: (r.images || []).map(viaProxy).slice(0, 3) };
      });
  }

  function build(data, over) {
    over = over || {};
    const d = data.detail;
    const images = (d.images || []).map(viaProxy);
    // 직접 올린 사진 (소구 이미지 탭과 같은 저장소: price-scraper /api/sogu, PK별)
    const mine = ((data.saved && data.saved.photos) || []).map((p) => viaProxy(p.url));
    const pick = (i) => {
      if (i == null || i === '없음' || i === 'none' || i === '') return null;
      const m = String(i).match(/^내\s*(\d+)$/);
      return m ? mine[+m[1] - 1] || null : images[+i] || null;
    };
    const name = over.name || cleanName(d.name);
    const sales = data.sales || {};

    // 상품 구성: 직접 입력이 있으면 그대로, 없으면 판매 중인 상품(1박) 머리말별 최저가
    const autoPk = (root.Sogu ? root.Sogu.packagesOf(sales) : []).map((p) => ({
      tag: p.tag,
      desc: p.rooms.slice(0, 4).join(' · ') + (p.rooms.length > 4 ? ` 외 ${p.rooms.length - 4}개` : ''),
      price: p.price,
      priceText: '',
    }));
    const packages = over.packages != null ? over.packages : autoPk;

    // 객실: 직접 입력(제목 | 설명 | 사진번호) — 사진번호가 없으면 같은 이름 객실의 놀발 객실 사진
    const autoRm = autoRooms(data);
    const rooms = over.rooms != null
      ? over.rooms.map((c) => {
          const same = autoRm.find((r) => r.title === c.title);
          return { title: c.title, desc: c.desc, images: c.img != null ? c.img.map(pick).filter(Boolean) : same ? same.images : [] };
        })
      : autoRm;

    const facilityCards = (over.facilityCards || []).map((c) => ({ title: c.title, desc: c.desc, images: (c.img || []).map(pick).filter(Boolean) }));
    // 놀발 시설 목록 → 시설마다 사진 타일 (사진은 탭에서 시설별 번호로 고름: facilityPhotos { 시설명: '12' })
    // 탭에서 뺀 시설(facilityHide)은 빼고, 직접 추가한 시설(facilityAdd: [{name, section}])은 그 묶음 끝에
    const fp = over.facilityPhotos || {};
    const hideF = new Set(over.facilityHide || []);
    const secs = (d.facilitySections || []).map((s) => ({ title: s.title || '부대시설', items: [...(s.items || [])] }));
    for (const a of over.facilityAdd || []) {
      if (!a.name) continue;
      let sec = secs.find((s) => s.title === a.section);
      if (!sec) secs.push((sec = { title: a.section || '그 밖의 시설', items: [] }));
      if (!sec.items.includes(a.name)) sec.items.push(a.name);
    }
    const facilitySections = secs
      .map((s) => ({ title: s.title, items: s.items.filter((n) => !hideF.has(n)).map((n) => ({ name: n, image: pick(fp[n]) })) }))
      .filter((s) => s.items.length);

    // 이용 안내: 놀발 상세의 체크인·추가요금·안내·공통 유의사항 블록 (취소/문의 블록은 따로)
    const all = [
      ...blocks(d.checkInfo, 'c'),
      ...blocks(d.extraChargeInfo, 'e'),
      ...blocks(d.noticeInfo, 'n'),
      ...blocks(d.importantNotice, 'i').map((b) => ({ ...b, title: b.title || '공통 유의사항' })),
    ];
    const hide = new Set(over.hideBlocks || []);
    const shown = all.filter((b) => !hide.has(b.key));
    // 제목 없는 맨 앞 안내(예: "2박 이상은 1박씩 각각 예약")는 '구매 전 꼭 확인'으로 올린다
    const lead = shown.filter((b) => !b.title);
    const notice = over.notice != null ? over.notice : lead.flatMap((b) => b.lines).map((l) => l.replace(/^[※*\s]+|[※*\s]+$/g, '')).filter(Boolean);
    const infos = shown.filter((b) => b.title && !isCancel(b) && !isContact(b));
    const cancel = shown.filter(isCancel);
    const contacts = shown.filter(isContact);

    // 대표 사진 + 갤러리(기본: 대표 다음 6장)
    const heroMine = /^내\d+$/.test(String(over.heroIndex || '')) ? pick(over.heroIndex) : null;
    const heroIdx = heroMine ? -1 : Math.min(Math.max(+over.heroIndex || 0, 0), Math.max(images.length - 1, 0));
    const gallery = over.gallery != null
      ? over.gallery.map(pick).filter(Boolean)
      : images.filter((_, i) => i !== heroIdx).slice(0, 6);

    const stayAuto = sales.firstOpen ? `${ymdDot(sales.firstOpen)} ~ ${sales.lastOpen && sales.lastOpen < sales.to ? ymdDot(sales.lastOpen) : ''}`.trim() : '';
    const periods = [
      ['판매기간', over.salePeriod || ''],
      ['투숙기간', over.stayPeriod != null ? over.stayPeriod : stayAuto],
    ].filter(([, v]) => v);

    return {
      pk: data.pk,
      name,
      type: d.type || '',
      region: d.region || '',
      address: d.address || '',
      contact: d.contact || '',
      copy: over.copy != null ? over.copy : [d.region, d.type].filter(Boolean).join(' · '),
      hero: over.heroImage || heroMine || images[heroIdx] || '',
      images,
      periods,
      notice,
      packages,
      gallery,
      rooms,
      facilitySections,
      facilityCards,
      blocks: all,
      infos,
      cancel,
      contacts,
      steps: over.steps || [],
      contactNote: over.contactNote || '',
      cs: over.cs != null ? over.cs : `${NOLBAL_CS} (${NOLBAL_CS_HOURS})`,
    };
  }

  // 블록 줄: "- 내용" → 목록, "※ / *" → 작은 주석, "ㄴ" → 들여쓴 보충
  function lines(ls) {
    return `<ul class="dt-lines">${ls
      .map((l) => {
        if (/^(※|\*)/.test(l)) return `<li class="note">${esc(l.replace(/^(※|\*)\s*/, ''))}</li>`;
        if (/^ㄴ/.test(l)) return `<li class="sub">${esc(l.replace(/^ㄴ\s*/, ''))}</li>`;
        if (/^\d+[.)]\s/.test(l)) return `<li class="num">${esc(l)}</li>`;
        return `<li>${esc(l.replace(/^[-•·]\s*/, ''))}</li>`;
      })
      .join('')}</ul>`;
  }
  const head = (en, ko) => `<div class="dt-h"><small>${esc(en)}</small><h3>${esc(ko)}</h3></div>`;
  // 카드 사진: 첫 장 크게, 나머지는 두 칸씩
  const cardImgs = (list) =>
    !list || !list.length
      ? ''
      : `<img src="${esc(list[0])}" alt="">${list.length > 1 ? `<div class="dt-sub">${list.slice(1).map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}`;
  const csBox = (cs) => {
    const [, no, rest] = String(cs).match(/^([^(]+?)\s*(\(.*\))?$/) || [null, cs, ''];
    return `<div class="dt-cs"><b>놀이의발견 고객센터</b><strong>${esc(no)}</strong>${rest ? `<span>${esc(rest.replace(/^\(|\)$/g, ''))}</span>` : ''}</div>`;
  };

  function render(el, m) {
    const h = [];
    h.push(`<div class="dt-cv">`);
    // HERO
    h.push(`<section class="dt-hero" data-cut>
      ${m.hero ? `<img src="${esc(m.hero)}" alt="">` : ''}
      <p class="dt-brand">놀이의발견</p>
      <div class="dt-hero-in">
        ${m.copy ? `<p class="dt-copy">${mark(m.copy)}</p>` : ''}
        <h1>${esc(m.name)}</h1></div>
    </section>`);
    if (m.periods.length) {
      h.push(`<section class="dt-period" data-cut>${m.periods.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</section>`);
    }
    if (m.notice.length) {
      h.push(`<section class="dt-sec" data-cut>${head('NOTICE', '구매 전 꼭 확인해주세요')}<div class="dt-box warn">${lines(m.notice)}</div></section>`);
    }
    if (m.packages.length) {
      h.push(`<section class="dt-sec tint" data-cut>${head('PRODUCT', '상품 구성')}<div class="dt-pkgs">`);
      m.packages.forEach((p, i) => {
        h.push(`<div class="dt-pkg"><div class="no">OPTION ${i + 1}</div><b>${mark(p.tag)}</b>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
          ${p.price ? `<div class="pr"><small>1박</small>${won(p.price)}<small>원~</small></div>` : p.priceText ? `<div class="pr">${esc(p.priceText)}</div>` : ''}</div>`);
      });
      h.push(`</div><p class="dt-fine">표시 가격은 판매 기간 중 최저가이며 날짜·객실에 따라 달라집니다.</p></section>`);
    }
    if (m.gallery.length) {
      h.push(`<section class="dt-sec" data-cut>${head('STAY', esc(m.name))}<div class="dt-gal">${m.gallery.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div></section>`);
    }
    if (m.rooms.length) {
      h.push(`<section class="dt-sec" data-cut>${head('ROOM', '객실 안내')}</section>`);
      m.rooms.forEach((r) => {
        h.push(`<section class="dt-card" data-cut>${cardImgs(r.images)}<div class="dt-card-t"><b>${mark(r.title)}</b>${r.desc ? `<p>${esc(r.desc)}</p>` : ''}</div></section>`);
      });
    }
    if (m.facilityCards.length || m.facilitySections.length) {
      h.push(`<section class="dt-sec tint" data-cut>${head('FACILITY', '부대시설')}</section>`);
      // 시설 목록: 사진을 고른 시설은 사진 타일, 안 고른 시설은 아래 이름 칩
      m.facilitySections.forEach((s) => {
        const withImg = s.items.filter((x) => x.image);
        const rest = s.items.filter((x) => !x.image);
        h.push(`<section class="dt-fac" data-cut><h4>${esc(s.title || '부대시설')}</h4>
          ${withImg.length ? `<div class="dt-tiles">${withImg.map((x) => `<figure><img src="${esc(x.image)}" alt=""><figcaption>${esc(x.name)}</figcaption></figure>`).join('')}</div>` : ''}
          ${rest.length ? `<div class="chips">${rest.map((x) => `<span>${esc(x.name)}</span>`).join('')}</div>` : ''}</section>`);
      });
      m.facilityCards.forEach((c) => {
        h.push(`<section class="dt-card tint" data-cut>${cardImgs(c.images)}<div class="dt-card-t"><b>${mark(c.title)}</b>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}</div></section>`);
      });
    }
    if (m.steps.length) {
      h.push(`<section class="dt-sec" data-cut>${head('HOW TO', '예약 및 이용 방법')}<ol class="dt-steps">${m.steps.map((s, i) => `<li><i>${i + 1}</i><span>${mark(s)}</span></li>`).join('')}</ol></section>`);
    }
    if (m.infos.length) {
      h.push(`<section class="dt-sec" data-cut>${head('INFORMATION', '이용 안내')}</section>`);
      m.infos.forEach((b) => h.push(`<section class="dt-blk" data-cut><h4>${esc(b.title)}</h4>${lines(b.lines)}</section>`));
    }
    if (m.cancel.length) {
      h.push(`<section class="dt-sec dark" data-cut>${head('CANCELLATION POLICY', '취소 · 환불 규정')}${m.cancel.map((b) => `<div class="dt-box">${m.cancel.length > 1 ? `<h4>${esc(b.title)}</h4>` : ''}${lines(b.lines)}</div>`).join('')}
        ${m.cs ? csBox(m.cs) : ''}</section>`);
    }
    if (m.address || m.contact || m.contacts.length || m.contactNote || (!m.cancel.length && m.cs)) {
      h.push(`<section class="dt-sec" data-cut>${head('LOCATION', '오시는 길 · 문의')}<div class="dt-box">
        ${m.address ? `<p class="dt-kv"><b>주소</b><span>${esc(m.address)}</span></p>` : ''}
        ${m.contact ? `<p class="dt-kv"><b>숙소 연락처</b><span>${esc(m.contact)}</span></p>` : ''}
        ${m.contactNote ? `<p class="dt-kv"><b>예약 문의</b><span>${esc(m.contactNote)}</span></p>` : ''}
        ${m.contacts.map((b) => `<h4>${esc(b.title)}</h4>${lines(b.lines)}`).join('')}
      </div>${!m.cancel.length && m.cs ? csBox(m.cs) : ''}</section>`);
    }
    h.push(`<p class="dt-foot" data-cut>사진은 이해를 돕기 위한 이미지로 실제와 다를 수 있습니다. 표시 정보는 숙소 사정에 따라 변경될 수 있습니다.</p>`);
    h.push(`</div>`);
    el.innerHTML = h.join('');
    return el.firstElementChild;
  }

  root.Detail = { build, render, blocks, parseCards, photoNos, ymdDot };
})(typeof window !== 'undefined' ? window : globalThis);
