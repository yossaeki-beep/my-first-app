(() => {
  const $ = id => document.getElementById(id);
  let viewMonth = new Date(); // 記録画面で表示中の月
  let tick = null;

  /* ---------- 共通 ---------- */
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function vibrate(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  function currentPunches() {
    const id = Store.state.currentStaffId;
    return id ? Store.punchesOf(id) : [];
  }

  /* ---------- 打刻画面 ---------- */
  function renderPunchView() {
    const punches = currentPunches();
    const now = new Date();
    const st = Calc.currentState(punches, now);

    const card = $('statusCard');
    card.classList.toggle('working', st.status === 'work');
    card.classList.toggle('breaking', st.status === 'break');
    $('statusLabel').textContent =
      st.status === 'work' ? '勤務中' : st.status === 'break' ? '休憩中' : '未出勤';

    $('statusClock').textContent = Calc.hhmm(now);

    const todayKey = Calc.dateKey(now);
    const today = Calc.byDay(punches, now).find(d => d.date === todayKey);
    $('statusSub').textContent = today
      ? `本日の実働 ${Calc.fmtMin(today.workMin)}（休憩 ${Calc.fmtMin(today.breakMin)}）`
      : '本日の実働 0:00';

    const has = !!Store.state.currentStaffId;
    $('view-punch').querySelector('[data-type="in"]').disabled     = !has || st.status !== 'off';
    $('view-punch').querySelector('[data-type="out"]').disabled    = !has || st.status === 'off';
    $('view-punch').querySelector('[data-type="bstart"]').disabled = !has || st.status !== 'work';
    $('view-punch').querySelector('[data-type="bend"]').disabled   = !has || st.status !== 'break';

    // 本日の打刻一覧。日またぎの夜勤は「前日分」「翌日」と明示して取り違えを防ぐ
    const list = $('todayPunches');
    list.innerHTML = '';
    const sessionOf = new Map();
    for (const s of Calc.sessions(punches)) {
      for (const p of s.punches) sessionOf.set(p.id, s);
    }
    const shown = punches.filter(p => {
      if (Calc.dateKey(new Date(p.ts)) === todayKey) return true;
      const s = sessionOf.get(p.id);
      return !!s && Calc.dateKey(s.in) === todayKey;
    });
    if (!shown.length) {
      list.innerHTML = '<li class="empty">まだ打刻がありません</li>';
      return;
    }
    for (const p of shown) {
      const d = new Date(p.ts);
      const s = sessionOf.get(p.id);
      const startKey = s ? Calc.dateKey(s.in) : Calc.dateKey(d);
      let suffix = '';
      if (startKey !== todayKey) suffix = `（${startKey.slice(5).replace('-', '/')}出勤分）`;
      else if (Calc.dateKey(d) !== todayKey) suffix = '（翌日）';
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="t">${Calc.hhmm(d)}</span>
        <span class="kind ${p.type}">${Calc.TYPE_LABEL[p.type]}${suffix}</span>
        ${p.manual ? `<span class="tag">手入力${p.note ? '・' + escapeHtml(p.note) : ''}</span>` : ''}
        <button class="del" data-del="${p.id}" aria-label="削除">×</button>`;
      list.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function punch(type) {
    if (!Store.state.currentStaffId) { toast('先に設定でスタッフを登録してください'); return; }
    const p = Store.addPunch(type, new Date());
    if (!p) { toast('保存できませんでした'); return; }
    vibrate(30);
    toast(`${Calc.TYPE_LABEL[type]}を記録しました`);
    renderPunchView();
  }

  /* ---------- 記録画面 ---------- */
  function renderLogView() {
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    $('monthLabel').textContent = `${y}年${m + 1}月`;

    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const days = Calc.byDay(currentPunches()).filter(d => d.date.startsWith(prefix));

    const totalWork = days.reduce((s, d) => s + d.workMin, 0);
    const totalBreak = days.reduce((s, d) => s + d.breakMin, 0);
    $('sumDays').textContent = `${days.length} 日`;
    $('sumWork').textContent = Calc.fmtMin(totalWork);
    $('sumBreak').textContent = Calc.fmtMin(totalBreak);
    $('sumRounded').textContent = Calc.fmtMin(Calc.roundTotal(totalWork, Store.state.settings.rounding));

    const list = $('dayList');
    list.innerHTML = '';
    if (!days.length) {
      list.innerHTML = '<li class="empty">この月の記録はありません</li>';
      return;
    }
    const dow = ['日', '月', '火', '水', '木', '金', '土'];
    for (const d of days) {
      const dt = new Date(d.date + 'T00:00:00');
      const detail = d.sessions.map(s => {
        const inS = Calc.hhmm(s.in);
        const outS = s.out
          ? Calc.hhmm(s.out) + (Calc.dateKey(s.out) !== d.date ? '(翌)' : '')
          : '―';
        return `${inS} 〜 ${outS}`;
      }).join(' / ');
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="day-row">
          <span class="day-date">${dt.getMonth() + 1}/${dt.getDate()}<span class="dow">${dow[dt.getDay()]}</span></span>
          <span class="day-work">${Calc.fmtMin(d.workMin)}</span>
        </div>
        <div class="day-detail">${detail}　休憩 ${Calc.fmtMin(d.breakMin)}</div>
        ${d.open ? '<div class="day-warn">退勤打刻がありません</div>' : ''}`;
      list.appendChild(li);
    }
  }

  function exportCsv() {
    const staff = Store.state.staff.find(s => s.id === Store.state.currentStaffId);
    if (!staff) { toast('スタッフが選択されていません'); return; }
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const days = Calc.byDay(currentPunches()).filter(d => d.date.startsWith(prefix));

    const rows = [['氏名', '日付', '出勤', '退勤', '休憩(分)', '実働(分)', '実働(時:分)', '備考']];
    for (const d of days) {
      d.sessions.forEach((s, i) => {
        rows.push([
          staff.name,
          d.date,
          Calc.hhmm(s.in),
          s.out ? Calc.hhmm(s.out) + (Calc.dateKey(s.out) !== d.date ? '(翌日)' : '') : '',
          Math.round(Calc.breakMin(s)),
          Math.round(Calc.workMin(s)),
          Calc.fmtMin(Calc.workMin(s)),
          [s.out ? '' : '退勤打刻なし', i > 0 ? '同日2回目以降' : '',
           s.punches.some(p => p.manual) ? '手入力あり' : ''].filter(Boolean).join(' ')
        ]);
      });
    }
    const totalWork = days.reduce((s, d) => s + d.workMin, 0);
    rows.push([]);
    rows.push([staff.name, `${prefix} 合計`, '', '', Math.round(days.reduce((s, d) => s + d.breakMin, 0)),
      Math.round(totalWork), Calc.fmtMin(totalWork), '端数処理前']);
    if (Store.state.settings.rounding !== 'none') {
      const r = Calc.roundTotal(totalWork, Store.state.settings.rounding);
      rows.push([staff.name, `${prefix} 合計`, '', '', '', Math.round(r), Calc.fmtMin(r), '月合計30分丸め後']);
    }

    const csv = rows.map(r => r.map(cell => {
      const v = String(cell ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\r\n');

    // Excelで文字化けしないようBOM付きUTF-8
    download(new Blob(['﻿' + csv], { type: 'text/csv' }),
      `timecard_${staff.name}_${prefix}.csv`);
    toast('CSVを書き出しました');
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 設定画面 ---------- */
  function renderStaffSelect() {
    const sel = $('staffSelect');
    sel.innerHTML = '';
    if (!Store.state.staff.length) {
      sel.innerHTML = '<option value="">未登録</option>';
      return;
    }
    for (const s of Store.state.staff) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      if (s.id === Store.state.currentStaffId) o.selected = true;
      sel.appendChild(o);
    }
  }

  function renderSettingsView() {
    const list = $('staffList');
    list.innerHTML = '';
    if (!Store.state.staff.length) {
      list.innerHTML = '<li class="empty">スタッフを追加してください</li>';
    }
    for (const s of Store.state.staff) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="kind" style="flex:1">${escapeHtml(s.name)}</span>
        <button class="del" data-rename="${s.id}" aria-label="名前変更">✎</button>
        <button class="del" data-rmstaff="${s.id}" aria-label="削除">×</button>`;
      list.appendChild(li);
    }
    $('roundingSelect').value = Store.state.settings.rounding;
    const n = Store.state.punches.length;
    $('versionNote').textContent = `保存済みの打刻: ${n} 件 / スタッフ ${Store.state.staff.length} 名`;
  }

  /* ---------- 画面切替 ---------- */
  function showView(name) {
    for (const v of ['punch', 'log', 'settings']) {
      $('view-' + v).classList.toggle('hidden', v !== name);
    }
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === name));
    if (name === 'punch') renderPunchView();
    if (name === 'log') renderLogView();
    if (name === 'settings') renderSettingsView();
  }

  /* ---------- イベント ---------- */
  function bind() {
    document.querySelectorAll('.punch-btn').forEach(b =>
      b.addEventListener('click', () => punch(b.dataset.type)));

    document.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => showView(t.dataset.view)));

    $('staffSelect').addEventListener('change', e => {
      Store.setCurrentStaff(e.target.value);
      renderPunchView();
      renderLogView();
    });

    $('todayPunches').addEventListener('click', e => {
      const id = e.target.dataset.del;
      if (!id) return;
      if (confirm('この打刻を削除しますか？')) {
        Store.removePunch(id);
        renderPunchView();
      }
    });

    $('prevMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      renderLogView();
    });
    $('nextMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      renderLogView();
    });
    $('csvBtn').addEventListener('click', exportCsv);

    $('addStaffBtn').addEventListener('click', () => {
      const name = $('newStaffName').value;
      if (!name.trim()) { toast('氏名を入力してください'); return; }
      Store.addStaff(name);
      $('newStaffName').value = '';
      renderStaffSelect();
      renderSettingsView();
      renderPunchView();
    });

    $('staffList').addEventListener('click', e => {
      const rn = e.target.dataset.rename;
      const rm = e.target.dataset.rmstaff;
      if (rn) {
        const s = Store.state.staff.find(x => x.id === rn);
        const name = prompt('氏名', s ? s.name : '');
        if (name) { Store.renameStaff(rn, name); renderStaffSelect(); renderSettingsView(); }
      }
      if (rm) {
        if (confirm('このスタッフを一覧から外しますか？（打刻記録はバックアップ内に残ります）')) {
          Store.removeStaff(rm);
          renderStaffSelect(); renderSettingsView(); renderPunchView();
        }
      }
    });

    $('roundingSelect').addEventListener('change', e => {
      Store.setRounding(e.target.value);
      renderLogView();
      toast('端数処理の設定を変更しました');
    });

    $('backupBtn').addEventListener('click', () => {
      const d = new Date();
      download(new Blob([Store.exportJSON()], { type: 'application/json' }),
        `timecard_backup_${Calc.dateKey(d)}.json`);
      toast('バックアップを書き出しました');
    });

    $('restoreBtn').addEventListener('click', () => $('restoreFile').click());
    $('restoreFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const added = Store.importJSON(await f.text());
        toast(`${added} 件の打刻を取り込みました`);
        renderStaffSelect(); renderSettingsView(); renderPunchView(); renderLogView();
      } catch (err) {
        alert('復元できませんでした: ' + err.message);
      }
      e.target.value = '';
    });

    // 手入力（打刻漏れの修正）
    $('manualBtn').addEventListener('click', () => {
      if (!Store.state.currentStaffId) { toast('先に設定でスタッフを登録してください'); return; }
      const now = new Date();
      $('manualDate').value = Calc.dateKey(now);
      $('manualTime').value = Calc.hhmm(now);
      $('manualNote').value = '';
      $('manualDialog').showModal();
    });

    $('manualForm').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value !== 'ok') return;
      const date = $('manualDate').value, time = $('manualTime').value;
      if (!date || !time) return;
      const ts = new Date(`${date}T${time}`);
      if (isNaN(ts)) { toast('日時が不正です'); return; }
      Store.addPunch($('manualType').value, ts, { manual: true, note: $('manualNote').value });
      toast('手入力で追加しました');
      setTimeout(() => { renderPunchView(); renderLogView(); }, 0);
    });

    // バックグラウンド復帰時に表示を更新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderPunchView();
    });
  }

  /* ---------- 起動 ---------- */
  function init() {
    bind();
    renderStaffSelect();
    showView('punch');
    tick = setInterval(() => {
      if (!$('view-punch').classList.contains('hidden')) renderPunchView();
    }, 15000);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
