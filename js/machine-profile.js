(function (root, factory) {
  const mod = factory(root.BTHG || (root.BTHG = {}));
  if (typeof module === 'object' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis, function (BTHG) {
  const KEY = 'bthg_machines';
  const ACTIVE_KEY = 'bthg_active_machine';
  const AMERICAN_LAYOUT = [37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1];

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function writeAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  const MachineProfiles = {
    AMERICAN_LAYOUT,
    list: readAll,
    get(id) { return readAll().find(p => p.id === id) || null; },
    save(profile) {
      if (!(profile.minUnit >= 0.25)) throw new Error('Table minimum betting unit must be $0.25 or more');
      if (!(profile.maxUnit <= 1500)) throw new Error('Table maximum betting unit must be $1,500 or less');
      if (profile.minUnit > profile.maxUnit) throw new Error('Minimum unit cannot exceed maximum unit');
      const list = readAll();
      if (!profile.id) {
        profile.id = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        profile.createdAt = new Date().toISOString();
      }
      if (!profile.wheelLayout) { profile.wheelLayout = AMERICAN_LAYOUT.slice(); profile.verifiedLayout = false; }
      const i = list.findIndex(p => p.id === profile.id);
      if (i >= 0) list[i] = profile; else list.push(profile);
      writeAll(list);
      return profile;
    },
    remove(id) { writeAll(readAll().filter(p => p.id !== id));
      if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY); },
    setActive(id) { localStorage.setItem(ACTIVE_KEY, id); },
    getActive() { return this.get(localStorage.getItem(ACTIVE_KEY)); },
  };
  BTHG.MachineProfiles = MachineProfiles;
  return MachineProfiles;
});
