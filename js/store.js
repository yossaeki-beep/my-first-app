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

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      const parsed = JSON.parse(raw);
      return Object.assign(structuredClone(DEFAULT), parsed);
    } catch (e) {
      console.error('読み込み失敗', e);
      return structuredClone(DEFAULT);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      // 容量超過やプライベートモードでは書き込みが落ちる
      console.error('保存失敗', e);
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    get state() { return state; },

    addStaff(name) {
      const s = { id: uid(), name: name.trim() };
      if (!s.name) return null;
      state.staff.push(s);
      if (!state.currentStaffId) state.currentStaffId = s.id;
      save();
      return s;
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

    removePunch(id) {
      state.punches = state.punches.filter(p => p.id !== id);
      save();
    },

    punchesOf(staffId) {
      return state.punches
        .filter(p => p.staffId === staffId)
        .sort((a, b) => a.ts.localeCompare(b.ts));
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
