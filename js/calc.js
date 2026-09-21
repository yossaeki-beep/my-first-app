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

  /* punches: 時刻昇順。戻り値は勤務セッションの配列。 */
  function sessions(punches) {
    const out = [];
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
          break;
        case 'bend':
          if (cur && openBreak) {
            cur.breaks.push({ start: openBreak, end: t });
            openBreak = null;
            cur.punches.push(p);
          }
          break;
        case 'out':
          if (cur) { cur.punches.push(p); close(cur, t); cur = null; }
          break;
      }
    }
    if (cur) { cur.openBreak = openBreak; out.push(cur); } // 勤務中
    return out;
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

  /* 日別集計（出勤日で束ねる）。 */
  function byDay(punches, now = new Date()) {
    const map = new Map();
    for (const s of sessions(punches)) {
      const key = dateKey(s.in);
      if (!map.has(key)) map.set(key, { date: key, sessions: [], workMin: 0, breakMin: 0, open: false });
      const d = map.get(key);
      d.sessions.push(s);
      d.workMin += workMin(s, now);
      d.breakMin += breakMin(s);
      if (!s.out) d.open = true;
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

  return { TYPE_LABEL, dateKey, hhmm, fmtMin, sessions, byDay, workMin, breakMin, roundTotal, currentState };
})();
