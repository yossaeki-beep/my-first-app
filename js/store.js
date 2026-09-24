/* 保存層。打刻イベントは追記のみで持ち、集計は calc.js で都度導出する。
   生ログを残す方が、あとから「実際に何時に押したか」を確認できる。 */
const Store = (() => {
  const KEY = 'timecard.v1';
  const DEFAULT = {
    version: 1,
    staff: [],          // { id, name }
    currentStaffId: null,
    punches: [],        // { id, staffId, type:'in'|'out'|'bstart'|'bend', ts:ISO, manual:bool, note:string }
    settings: { rounding: 'none' }
  };

  let lastError = null;

  /* structuredClone は iOS 15.4 以降しか無い。古い端末でアプリ全体が
     起動しなくなるため、JSONで複製する。 */
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT);
      return Object.assign(clone(DEFAULT), JSON.parse(raw));
    } catch (e) {
      console.error('読み込み失敗', e);
      lastError = e;
      return clone(DEFAULT);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastError = null;
      return true;
    } catch (e) {
      // 容量超過やプライベートブラウズでは書き込みが落ちる。
      // 黙って失敗すると「登録したのに残らない」になるので記録しておく。
      console.error('保存失敗', e);
      lastError = e;
      return false;
    }
  }

  let state = load();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* 書き込みが本当に通るかを実際に試す。プライベートブラウズでは
     localStorage が存在しても setItem で例外になる。 */
  function storageAvailable() {
    try {
      const k = KEY + '.probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      lastError = e;
      return false;
    }
  }

  return {
    get state() { return state; },
    get lastError() { return lastError; },
    storageAvailable,

    addStaff(name) {
      const s = { id: uid(), name: name.trim() };
      if (!s.name) return null;
      state.staff.push(s);
      if (!state.currentStaffId) state.currentStaffId = s.id;
      return save() ? s : null;
    },

    renameStaff(id, name) {
      const s = state.staff.find(x => x.id === id);
      if (!s || !name.trim()) return;
      s.name = name.trim();
      save();
    },

    /* スタッフを消しても打刻ログは残す（誤操作で勤怠実績が消えないように）。
       表示から外れるだけで、バックアップJSONには残る。 */
    removeStaff(id) {
      state.staff = state.staff.filter(x => x.id !== id);
      if (state.currentStaffId === id) {
        state.currentStaffId = state.staff[0] ? state.staff[0].id : null;
      }
      save();
    },

    setCurrentStaff(id) {
      state.currentStaffId = id;
      save();
    },

    addPunch(type, ts, { manual = false, note = '' } = {}) {
      const staffId = state.currentStaffId;
      if (!staffId) return null;
      const p = { id: uid(), staffId, type, ts: ts.toISOString(), manual, note };
      state.punches.push(p);
      save();
      return p;
    },

    /* 修正しても元の打刻値は origTs に残す。
       「実際に何時に押したか」を失わないことが、あとで実態を確認できる条件。 */
    editPunch(id, newTs, reason = '', newType = null) {
      const p = state.punches.find(x => x.id === id);
      if (!p) return null;
      if (!p.origTs) p.origTs = p.ts;   // 2回目以降の修正でも最初の値を保持
      if (newType && newType !== p.type) {
        if (!p.origType) p.origType = p.type;
        p.type = newType;
      }
      p.ts = newTs.toISOString();
      p.edited = true;
      p.editNote = reason;
      p.editedAt = new Date().toISOString();
      save();
      return p;
    },

    /* 削除は論理削除。集計と一覧からは外れるが、バックアップJSONと
       修正履歴には残るため、あとから「何を消したか」を追える。 */
    removePunch(id, reason = '') {
      const p = state.punches.find(x => x.id === id);
      if (!p) return;
      p.deleted = true;
      p.deleteNote = reason;
      p.deletedAt = new Date().toISOString();
      save();
    },

    restorePunch(id) {
      const p = state.punches.find(x => x.id === id);
      if (!p) return;
      delete p.deleted;
      delete p.deleteNote;
      delete p.deletedAt;
      save();
    },

    punchesOf(staffId, { includeDeleted = false } = {}) {
      return state.punches
        .filter(p => p.staffId === staffId && (includeDeleted || !p.deleted))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    /* 指定日に関わる修正・削除の履歴（打刻日ベース。修正前の日付も拾う） */
    historyOn(staffId, dateKey) {
      return state.punches.filter(p => {
        if (p.staffId !== staffId) return false;
        if (!p.edited && !p.deleted) return false;
        const keys = [p.ts, p.origTs].filter(Boolean).map(t => {
          const d = new Date(t), z = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
        });
        return keys.includes(dateKey);
      }).sort((a, b) => a.ts.localeCompare(b.ts));
    },

    setRounding(v) {
      state.settings.rounding = v;
      save();
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    /* 復元は「置き換え」ではなく「打刻IDの和集合」。
       複数端末のバックアップを1台にまとめても実績が消えない。 */
    importJSON(text) {
      const incoming = JSON.parse(text);
      if (!incoming || !Array.isArray(incoming.punches)) throw new Error('形式が違います');
      const staffById = new Map(state.staff.map(s => [s.id, s]));
      (incoming.staff || []).forEach(s => { if (!staffById.has(s.id)) state.staff.push(s); });
      const punchIds = new Set(state.punches.map(p => p.id));
      let added = 0;
      incoming.punches.forEach(p => {
        if (!punchIds.has(p.id)) { state.punches.push(p); added++; }
      });
      if (!state.currentStaffId && state.staff[0]) state.currentStaffId = state.staff[0].id;
      save();
      return added;
    }
  };
})();
