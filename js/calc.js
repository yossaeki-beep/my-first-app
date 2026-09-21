/* 打刻ログから勤務セッションを組み立てる。
   夜勤（日またぎ）は出勤打刻をした日の実績として扱う。 */
const Calc = (() => {

  const TYPE_LABEL = { in: '出勤', out: '退勤', bstart: '休憩開始', bend: '休憩終了' };

  function dateKey(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function hhmm(d) {
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtMin(min) {
    const sign = min < 0 ? '-' : '';
    const m = Math.abs(Math.round(min));
    return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }

  /* punches: 時刻昇順。勤務セッションと、どのセッションにも属さない
     孤立打刻（出勤がないのに退勤だけある等）に分けて返す。
     孤立打刻を捨てるとその日が一覧から消えて修正できなくなるため、必ず拾う。 */
  function split(punches) {
    const out = [];
    const orphans = [];
    let cur = null;
    let openBreak = null;

    const close = (session, endTs) => {
      if (openBreak) {
        session.breaks.push({ start: openBreak, end: endTs });
        openBreak = null;
      }
      session.out = endTs;
      out.push(session);
    };

    for (const p of punches) {
      const t = new Date(p.ts);
      switch (p.type) {
        case 'in':
          // 退勤打刻がないまま次の出勤が来た場合は、未退勤のまま確定させる
          if (cur) { openBreak = null; out.push(cur); }
          cur = { in: t, out: null, breaks: [], punches: [p] };
          break;
        case 'bstart':
          if (cur && !openBreak) { openBreak = t; cur.punches.push(p); }
          else orphans.push(p);
          break;
        case 'bend':
          if (cur && openBreak) {
            cur.breaks.push({ start: openBreak, end: t });
            openBreak = null;
            cur.punches.push(p);
          } else orphans.push(p);
          break;
        case 'out':
          if (cur) { cur.punches.push(p); close(cur, t); cur = null; }
          else orphans.push(p);
          break;
      }
    }
    if (cur) { cur.openBreak = openBreak; out.push(cur); } // 勤務中
    return { sessions: out, orphans };
  }

  function sessions(punches) {
    return split(punches).sessions;
  }

  function breakMin(session) {
    return session.breaks.reduce((sum, b) => sum + (b.end - b.start) / 60000, 0);
  }

  /* 実働分。退勤前なら now までの暫定値。 */
  function workMin(session, now = new Date()) {
    const end = session.out || now;
    let brk = breakMin(session);
    if (!session.out && session.openBreak) brk += (now - session.openBreak) / 60000;
    return Math.max(0, (end - session.in) / 60000 - brk);
  }

  /* 日別集計（出勤日で束ねる）。孤立打刻もその打刻日にぶら下げる。 */
  function byDay(punches, now = new Date()) {
    const map = new Map();
    const blank = key => ({ date: key, sessions: [], orphans: [], workMin: 0, breakMin: 0, open: false });

    const { sessions: ss, orphans } = split(punches);
    for (const s of ss) {
      const key = dateKey(s.in);
      if (!map.has(key)) map.set(key, blank(key));
      const d = map.get(key);
      d.sessions.push(s);
      d.workMin += workMin(s, now);
      d.breakMin += breakMin(s);
      if (!s.out) d.open = true;
    }
    for (const p of orphans) {
      const key = dateKey(new Date(p.ts));
      if (!map.has(key)) map.set(key, blank(key));
      map.get(key).orphans.push(p);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /* 月合計の端数処理。
     1日単位の切り捨ては労基法違反。月合計の30分丸めのみ認められている
     （昭63.3.14 基発第150号）ため、選択肢はこの2つだけにしている。 */
  function roundTotal(min, mode) {
    if (mode === 'm30') return Math.round(min / 30) * 30;
    return min;
  }

  function currentState(punches, now = new Date()) {
    const all = sessions(punches);
    const last = all[all.length - 1];
    if (!last || last.out) return { status: 'off', since: null, today: all };
    if (last.openBreak) return { status: 'break', since: last.openBreak, session: last };
    return { status: 'work', since: last.in, session: last };
  }

  return { TYPE_LABEL, dateKey, hhmm, fmtMin, split, sessions, byDay, workMin, breakMin, roundTotal, currentState };
})();
