// Fishing spots for the Travel Map. Each spot is a place you can fast-travel to
// and fish. Overworld spots carry an `anchor` (a point in that zone near water)
// used to drop the angler at the shoreline; interior/ferry spots use their map's
// own spawn. Locked spots (level gates, island not yet anchored) can't be visited.
//
// `id` matches a ZONE_LORE key so we can show each spot's name/tagline/lore.
export const FISHING_SPOTS = [
  { id: 'town', name: 'Willowbrook Harbor', map: 'overworld', biome: 'harbor', anchor: { x: -8, z: 150 }, minLevel: 1, group: 'overworld' },
  { id: 'pond', name: 'Dapplebrim Pond', map: 'overworld', biome: 'pond', anchor: { x: -300, z: 262 }, minLevel: 1, group: 'overworld' },
  { id: 'river', name: 'The Tumblesong River', map: 'overworld', biome: 'river', anchor: { x: -60, z: -180 }, minLevel: 1, group: 'overworld' },
  { id: 'lake', name: 'Mirrormere', map: 'overworld', biome: 'lake', anchor: { x: 300, z: -320 }, minLevel: 5, group: 'overworld' },
  { id: 'coast', name: 'Saltwhistle Shore', map: 'overworld', biome: 'coast', anchor: { x: 100, z: 470 }, minLevel: 8, group: 'overworld' },
  { id: 'docks', name: 'Driftwood Docks', map: 'overworld', biome: 'harbor', anchor: { x: 470, z: 460 }, minLevel: 10, group: 'overworld' },
  { id: 'swamp', name: 'Gurglemire Fen', map: 'overworld', biome: 'swamp', anchor: { x: -470, z: 80 }, minLevel: 14, group: 'overworld' },
  { id: 'glacier', name: 'Shiverpane Tarn', map: 'overworld', biome: 'glacier', anchor: { x: -425, z: -500 }, minLevel: 22, group: 'overworld' },
  { id: 'volcanic', name: 'Emberkettle Springs', map: 'overworld', biome: 'volcanic', anchor: { x: 585, z: -80 }, minLevel: 26, group: 'overworld' },

  { id: 'sewer', name: 'The Willowbrook Underworks', map: 'sewer', biome: 'sewer', minLevel: 6, group: 'secret' },
  { id: 'cave', name: 'Glimmerdeep Hollows', map: 'cave', biome: 'cave', minLevel: 18, group: 'secret' },

  { id: 'reef', name: 'Coralcrown Shallows', map: 'reef', biome: 'reef', minLevel: 16, group: 'ferry' },
  { id: 'deepsea', name: 'The Sunless Reach', map: 'deepsea', biome: 'deepsea', minLevel: 32, group: 'ferry' },
  { id: 'rig', name: 'Old Gertrude', map: 'rig', biome: 'rig', minLevel: 40, group: 'ferry' },
  { id: 'abyss', name: 'The Hushing Trench', map: 'abyss', biome: 'abyss', minLevel: 70, group: 'ferry' },

  { id: 'island', name: 'Keelhaven — your island', map: 'island', biome: 'island', needIsland: true, group: 'island' },
];

export const SPOTS_BY_ID = Object.fromEntries(FISHING_SPOTS.map((s) => [s.id, s]));

// Why a spot can't be visited (null = open). `lvl` is the current fishing level.
export function spotLockReason(spot, lvl, hasIsland) {
  if (spot.needIsland && !hasIsland) return 'Anchor your island first — see the Island Broker in Shops';
  if (spot.minLevel && lvl < spot.minLevel) return `Requires fishing level ${spot.minLevel}`;
  return null;
}
