// Tiny global event bus. Events used across the game:
//  'catch'        {fish, len, wt, record, zone}       — a fish was caught
//  'junk'         {name}                              — junk/treasure pulled up
//  'xp'           {amount, total}                     — xp gained
//  'levelup'      {level, abilities}                  — level increased
//  'coins'        {delta, total}                      — coin balance changed
//  'achievement'  {ach}                               — achievement completed
//  'zone'         {zone}                              — player entered zone
//  'flag'         {flag}                              — hidden flag set
//  'toast'        {text, sub, kind}                   — show toast
//  'chat'         {from, text, kind}                  — chat line (local or net)
//  'bubble'       {who, text}                         — overhead chat bubble ('me' or net id)
//  'state'        {}                                  — generic "state changed, refresh UI"
//  'fishing'      {phase}                             — fishing state machine phase change
//  'net:*'        …                                   — multiplayer events

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, data = {}) {
  const set = listeners.get(event);
  if (set) for (const fn of [...set]) {
    try { fn(data); } catch (e) { console.error(`[events] handler for "${event}" failed`, e); }
  }
}
