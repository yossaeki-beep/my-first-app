(() => {
  const $ = id => document.getElementById(id);
  let viewMonth = new Date();   // 記録画面で表示中の月
  let expandedDay = null;       // 記録画面で開いている日（修正パネル）
  let editingId = null;         // 修正ダイアログで編集中の打刻ID
  let manualDefaultDate = null; // 手入力ダイアログに入れる日付

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

  /* スマホではコンソールを見られないので、起動時の失敗を画面に出す。
     これが無いと「半透明のまま操作できない」だけで原因が分からない。 */
  function banner(msg, level = 'error') {
    const el = $('banner');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('warn', level === 'warn');
  }

  /* <dialog>.showModal() は iOS 15.4 以降。古い端末では open 属性で代用する。 */
  function openDialog(d) {
    if (typeof d.showModal === 'function') { d.showModal(); return; }
    d.classList.add('fallback');
    d.setAttribute('open', '');
  }

  function closeDialog(d) {
    if (typeof d.close === 'function' && !d.classList.contains('fallback')) d.close();
    else d.removeAttribute('open');
  }

  /* SubmitEvent.submitter も iOS 15.4 以降。直前に押されたボタンで代用する。 */
  let lastClicked = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function currentPunches() {
    const id = Store.state.currentStaffId;
    return id ? Store.punchesOf(id) : [];
  }

  /* 打刻に付ける状態タグ（手入力 / 修正済み） */
  function punchTags(p) {
    const tags = [];
    if (p.manual) tags.push('手入力' + (p.note ? '・' + p.note : ''));
    if (p.edited) {
      const was = [];
      if (p.origTs) was.push(Calc.hhmm(new Date(p.origTs)));
      if (p.origType) was.push(Calc.TYPE_LABEL[p.origType]);
      tags.push('修正済み' + (was.length ? `（元 ${was.join(' ')}）` : '') +
        (p.editNote ? '・' + p.editNote : ''));
    }
    return tags;
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
    $('setupCard').classList.toggle('hidden', has);
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
      const tags = punchTags(p);
      li.innerHTML = `
        <span class="t">${Calc.hhmm(d)}</span>
        <span class="kind ${p.type}">${Calc.TYPE_LABEL[p.type]}${suffix}</span>
        <span class="spacer"></span>
        <button class="del" data-del="${p.id}" aria-label="削除">×</button>
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}`;
      list.appendChild(li);
    }
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

    // 打刻を全部消した日も行として残す。消えてしまうと復元にたどり着けない
    const staffId = Store.state.currentStaffId;
    if (staffId) {
      const seen = new Set(days.map(d => d.date));
      for (const p of Store.punchesOf(staffId, { includeDeleted: true })) {
        if (!p.deleted) continue;
        const key = Calc.dateKey(new Date(p.ts));
        if (!key.startsWith(prefix) || seen.has(key)) continue;
        seen.add(key);
        days.push({ date: key, sessions: [], orphans: [], workMin: 0, breakMin: 0, open: false, onlyDeleted: true });
      }
      days.sort((a, b) => a.date.localeCompare(b.date));
    }

    const totalWork = days.reduce((s, d) => s + d.workMin, 0);
    const totalBreak = days.reduce((s, d) => s + d.breakMin, 0);
    $('sumDays').textContent = `${days.filter(d => d.sessions.length).length} 日`;
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
      const detail = d.sessions.length
        ? d.sessions.map(s => {
            const inS = Calc.hhmm(s.in);
            const outS = s.out
              ? Calc.hhmm(s.out) + (Calc.dateKey(s.out) !== d.date ? '(翌)' : '')
              : '―';
            return `${inS} 〜 ${outS}`;
          }).join(' / ')
        : (d.onlyDeleted ? '打刻をすべて削除済み' : '勤務時間を集計できません');
      const open = expandedDay === d.date;
      const li = document.createElement('li');
      li.className = 'expandable' + (open ? ' open' : '');
      li.dataset.date = d.date;
      li.innerHTML = `
        <div class="day-row">
          <span class="day-date">${dt.getMonth() + 1}/${dt.getDate()}<span class="dow">${dow[dt.getDay()]}</span></span>
          <span class="day-work">${Calc.fmtMin(d.workMin)}</span>
        </div>
        <div class="day-detail">${detail}　休憩 ${Calc.fmtMin(d.breakMin)}</div>
        ${d.open ? '<div class="day-warn">退勤打刻がありません</div>' : ''}
        ${d.orphans && d.orphans.length ? '<div class="day-warn">出勤打刻のない打刻があります</div>' : ''}
        <div class="day-toggle">${open ? '▲ 閉じる' : '▼ タップして修正'}</div>
        ${open ? renderDayEditor(d) : ''}`;
      list.appendChild(li);
    }
  }

  /* 日別の修正パネル。打刻ごとに修正・削除でき、削除済みも履歴として残す。 */
  function renderDayEditor(day) {
    const staffId = Store.state.currentStaffId;
    const rows = [];
    const active = [];
    for (const s of day.sessions) active.push(...s.punches);
    active.push(...(day.orphans || []));
    active.sort((a, b) => a.ts.localeCompare(b.ts));
    for (const p of active) {
      const d = new Date(p.ts);
      const cross = Calc.dateKey(d) !== day.date ? '（翌日）' : '';
      const tags = punchTags(p);
      rows.push(`
        <div class="edit-row">
          <span class="t">${Calc.hhmm(d)}</span>
          <span class="kind ${p.type}">${Calc.TYPE_LABEL[p.type]}${cross}</span>
          <span class="spacer"></span>
          <button class="act" data-edit="${p.id}">修正</button>
          <button class="act" data-remove="${p.id}">削除</button>
          ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>`);
    }

    // 削除済みの打刻（この日に関係するもの）を履歴として表示
    const removed = Store.historyOn(staffId, day.date).filter(p => p.deleted);
    for (const p of removed) {
      const d = new Date(p.ts);
      rows.push(`
        <div class="edit-row removed">
          <span class="t">${Calc.hhmm(d)}</span>
          <span class="kind ${p.type}">${Calc.TYPE_LABEL[p.type]}</span>
          <span class="spacer"></span>
          <button class="act" data-restore="${p.id}">戻す</button>
          <div class="tags"><span class="tag">削除済み${p.deleteNote ? '・' + escapeHtml(p.deleteNote) : ''}</span></div>
        </div>`);
    }

    return `<div class="day-edit">
      ${rows.join('')}
      <button class="day-add" data-add="${day.date}">この日に打刻を追加</button>
      <div class="history">
        <strong>記録の扱い</strong>
        修正しても元の打刻時刻は内部に保持され、削除は取り消せます。
        バックアップJSONには修正前・削除分も含まれます。
      </div>
    </div>`;
  }

  function exportCsv() {
    const staff = Store.state.staff.find(s => s.id === Store.state.currentStaffId);
    if (!staff) { toast('スタッフが選択されていません'); return; }
    const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const days = Calc.byDay(currentPunches()).filter(d => d.date.startsWith(prefix));

    const rows = [['氏名', '日付', '出勤', '退勤', '休憩(分)', '実働(分)', '実働(時:分)', '備考']];
    for (const d of days) {
      if (!d.sessions.length) {
        rows.push([staff.name, d.date, '', '', '', 0, '0:00',
          d.orphans && d.orphans.length ? '出勤打刻なし（要確認）' : '打刻をすべて削除済み']);
        continue;
      }
      d.sessions.forEach((s, i) => {
        rows.push([
          staff.name,
          d.date,
          Calc.hhmm(s.in),
          s.out ? Calc.hhmm(s.out) + (Calc.dateKey(s.out) !== d.date ? '(翌日)' : '') : '',
          Math.round(Calc.breakMin(s)),
          Math.round(Calc.workMin(s)),
          Calc.fmtMin(Calc.workMin(s)),
          [s.out ? '' : '退勤打刻なし',
           i > 0 ? '同日2回目以降' : '',
           s.punches.some(p => p.manual) ? '手入力あり' : '',
           s.punches.some(p => p.edited) ? '修正あり' : ''].filter(Boolean).join(' ')
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

    // 修正・削除の履歴を同じCSVに載せる（あとから根拠を確認できるように）
    const hist = Store.punchesOf(staff.id, { includeDeleted: true })
      .filter(p => (p.edited || p.deleted) && Calc.dateKey(new Date(p.ts)).startsWith(prefix));
    if (hist.length) {
      rows.push([]);
      rows.push(['【修正・削除履歴】']);
      rows.push(['氏名', '対象日時', '種別', '区分', '修正前', '理由', '操作日時', '']);
      for (const p of hist) {
        const d = new Date(p.ts);
        rows.push([
          staff.name,
          `${Calc.dateKey(d)} ${Calc.hhmm(d)}`,
          Calc.TYPE_LABEL[p.type],
          p.deleted ? '削除' : '修正',
          p.origTs ? `${Calc.dateKey(new Date(p.origTs))} ${Calc.hhmm(new Date(p.origTs))}` : '',
          p.deleted ? (p.deleteNote || '') : (p.editNote || ''),
          p.deletedAt || p.editedAt
            ? (() => { const t = new Date(p.deletedAt || p.editedAt); return `${Calc.dateKey(t)} ${Calc.hhmm(t)}`; })()
            : '',
          ''
        ]);
      }
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
    // 未登録のときは切り替え欄自体を隠す。ここから登録できると誤解されるため
    sel.classList.toggle('hidden', !Store.state.staff.length);
    if (!Store.state.staff.length) return;
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
    const all = Store.state.punches;
    const del = all.filter(p => p.deleted).length;
    $('versionNote').textContent =
      `有効な打刻: ${all.length - del} 件（削除済み ${del} 件を履歴として保持）/ スタッフ ${Store.state.staff.length} 名`;
  }

  /* ---------- 修正ダイアログ ---------- */
  function openEdit(punchId) {
    const p = Store.state.punches.find(x => x.id === punchId);
    if (!p) return;
    editingId = punchId;
    const d = new Date(p.ts);
    $('editType').value = p.type;
    $('editDate').value = Calc.dateKey(d);
    $('editTime').value = Calc.hhmm(d);
    $('editReason').value = p.editNote || '';
    const o = p.origTs ? new Date(p.origTs) : null;
    $('editOrig').textContent = o
      ? `元の打刻: ${Calc.dateKey(o)} ${Calc.hhmm(o)}（この値は修正後も保持されます）`
      : '修正すると、現在の値が「元の打刻」として保持されます。';
    openDialog($('editDialog'));
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

  function refreshAll() {
    renderPunchView();
    renderLogView();
    renderSettingsView();
  }

  /* ---------- イベント ---------- */
  function bind() {
    document.querySelectorAll('.punch-btn').forEach(b =>
      b.addEventListener('click', () => punch(b.dataset.type)));

    document.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => showView(t.dataset.view)));

    $('staffSelect').addEventListener('change', e => {
      Store.setCurrentStaff(e.target.value);
      expandedDay = null;
      refreshAll();
    });

    $('todayPunches').addEventListener('click', e => {
      const id = e.target.dataset.del;
      if (!id) return;
      if (confirm('この打刻を削除しますか？（記録タブの該当日から戻せます）')) {
        Store.removePunch(id, '打刻画面から削除');
        refreshAll();
        toast('削除しました');
      }
    });

    $('prevMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      expandedDay = null;
      renderLogView();
    });
    $('nextMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      expandedDay = null;
      renderLogView();
    });
    $('csvBtn').addEventListener('click', exportCsv);

    // 日別リスト: 開閉 + 打刻の修正 / 削除 / 復元 / 追加
    $('dayList').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.edit) { openEdit(btn.dataset.edit); return; }
        if (btn.dataset.remove) {
          const reason = prompt('削除の理由（任意）', '');
          if (reason === null) return;
          Store.removePunch(btn.dataset.remove, reason);
          refreshAll();
          toast('削除しました（履歴に残ります）');
          return;
        }
        if (btn.dataset.restore) {
          Store.restorePunch(btn.dataset.restore);
          refreshAll();
          toast('元に戻しました');
          return;
        }
        if (btn.dataset.add) {
          manualDefaultDate = btn.dataset.add;
          openManual();
          return;
        }
      }
      // 開閉は日付ヘッダー側だけ。修正パネル内をタップしても閉じないようにする
      if (!e.target.closest('.day-row, .day-detail, .day-warn, .day-toggle')) return;
      const li = e.target.closest('li.expandable');
      if (!li) return;
      expandedDay = expandedDay === li.dataset.date ? null : li.dataset.date;
      renderLogView();
    });

    $('goSetupBtn').addEventListener('click', () => {
      showView('settings');
      const input = $('newStaffName');
      input.focus();
      input.scrollIntoView({ block: 'center' });
    });

    // iPhone ではキーボードが出ていると1回目のタップが空振りしやすいので、
    // 確定キーからも登録できるようにする
    $('newStaffName').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('addStaffBtn').click(); }
    });

    $('addStaffBtn').addEventListener('click', () => {
      const name = $('newStaffName').value;
      if (!name.trim()) { toast('氏名を入力してください'); return; }
      if (!Store.addStaff(name)) {
        banner('スタッフを保存できませんでした。ブラウザのプライベートモードや、サイトデータの保存がブロックされている可能性があります。'
          + (Store.lastError ? '（' + Store.lastError.message + '）' : ''));
        return;
      }
      const first = Store.state.staff.length === 1;
      $('newStaffName').value = '';
      $('newStaffName').blur();
      renderStaffSelect();
      refreshAll();
      toast(`${name.trim()} を登録しました`);
      // 最初の1人を登録したら、そのまま打刻画面へ戻す
      if (first) showView('punch');
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
          renderStaffSelect(); refreshAll();
        }
      }
    });

    $('roundingSelect').addEventListener('change', e => {
      Store.setRounding(e.target.value);
      renderLogView();
      toast('端数処理の設定を変更しました');
    });

    $('backupBtn').addEventListener('click', () => {
      download(new Blob([Store.exportJSON()], { type: 'application/json' }),
        `timecard_backup_${Calc.dateKey(new Date())}.json`);
      toast('バックアップを書き出しました');
    });

    $('restoreBtn').addEventListener('click', () => $('restoreFile').click());
    $('restoreFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const added = Store.importJSON(await f.text());
        toast(`${added} 件の打刻を取り込みました`);
        renderStaffSelect(); refreshAll();
      } catch (err) {
        alert('復元できませんでした: ' + err.message);
      }
      e.target.value = '';
    });

    // 手入力（打刻漏れの追加）
    $('manualBtn').addEventListener('click', () => { manualDefaultDate = null; openManual(); });

    $('manualForm').addEventListener('submit', e => {
      const sub = e.submitter || lastClicked;
      if (sub && sub.value !== 'ok') return;
      const date = $('manualDate').value, time = $('manualTime').value;
      if (!date || !time) return;
      const ts = new Date(`${date}T${time}`);
      if (isNaN(ts)) { toast('日時が不正です'); return; }
      Store.addPunch($('manualType').value, ts, { manual: true, note: $('manualNote').value });
      toast('手入力で追加しました');
      setTimeout(refreshAll, 0);
    });

    // 修正の保存
    $('editForm').addEventListener('submit', e => {
      const sub = e.submitter || lastClicked;
      if (sub && sub.value !== 'ok') { editingId = null; return; }
      const date = $('editDate').value, time = $('editTime').value;
      if (!date || !time || !editingId) return;
      const ts = new Date(`${date}T${time}`);
      if (isNaN(ts)) { toast('日時が不正です'); return; }
      // 押し間違いは種別ごと直せる。元の種別も履歴に残る
      Store.editPunch(editingId, ts, $('editReason').value, $('editType').value);
      editingId = null;
      toast('修正しました（元の値は保持されます）');
      setTimeout(refreshAll, 0);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderPunchView();
    });
  }

  function openManual() {
    if (!Store.state.currentStaffId) { toast('先に設定でスタッフを登録してください'); return; }
    const now = new Date();
    $('manualDate').value = manualDefaultDate || Calc.dateKey(now);
    $('manualTime').value = Calc.hhmm(now);
    $('manualNote').value = '';
    openDialog($('manualDialog'));
  }

  /* ---------- 起動 ---------- */
  function init() {
    // フォールバック用に、直前に押されたボタンを覚えておく
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button');
      if (b) lastClicked = b;
    }, true);

    // dialog 非対応端末では method="dialog" が効かないので、自前で閉じる
    document.querySelectorAll('dialog form').forEach(f => {
      f.addEventListener('submit', e => {
        const d = f.closest('dialog');
        if (d && typeof d.showModal !== 'function') { e.preventDefault(); closeDialog(d); }
      });
    });

    if (!Store.storageAvailable()) {
      banner('このブラウザでは打刻を保存できません。プライベートブラウズを解除するか、'
        + '設定でサイトデータの保存を許可してください。', 'warn');
    }

    bind();
    renderStaffSelect();
    showView('punch');
    setInterval(() => {
      if (!$('view-punch').classList.contains('hidden')) renderPunchView();
    }, 15000);

    if ('serviceWorker' in navigator) {
      // 新しい版が有効になったら1度だけ読み込み直す。
      // これが無いと、更新が「次に開いたとき」まで反映されない。
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !navigator.serviceWorker.controller) return;
        reloading = true;
        location.reload();
      });
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
      });
    }
  }

  // 起動時に落ちると画面が操作不能のまま無言で止まるので、原因を表示する
  window.addEventListener('error', e => {
    banner('アプリの読み込みでエラーが発生しました: ' + (e.message || e.type)
      + (e.filename ? ' [' + e.filename.split('/').pop() + ':' + e.lineno + ']' : ''));
  });

  document.addEventListener('DOMContentLoaded', () => {
    try { init(); }
    catch (e) { banner('起動に失敗しました: ' + e.message); }
  });
})();
