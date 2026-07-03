// Hand-authored static game data (not generated).

export const BACKPACK_TIERS = [
  { name: 'Frayed Satchel', slots: 12, price: 0 },
  { name: 'Canvas Pack', slots: 16, price: 400 },
  { name: 'Angler Pack', slots: 20, price: 1500 },
  { name: 'Wicker Creel', slots: 26, price: 5000 },
  { name: 'Voyager Pack', slots: 32, price: 16000 },
  { name: 'Duffel of Depths', slots: 40, price: 55000 },
  { name: 'Bottomless Bag', slots: 48, price: 180000 },
];

export const BANK_SLOTS = 600;

// Fishing level abilities (1-100). Passive keys feed into effect totals.
export const ABILITIES = [
  { lvl: 3,  name: 'Patient Hands',    desc: 'Fish bite a little faster.', fx: { biteRate: 0.05 } },
  { lvl: 5,  name: 'Long Cast I',      desc: 'Cast further out.', fx: { power: 1 } },
  { lvl: 8,  name: 'Keen Eyes',        desc: 'Bobber splashes hint at the size of a nibbler.', fx: { keenEyes: 1 } },
  { lvl: 10, name: 'Bait Saver',       desc: '12% chance your bait survives a catch.', fx: { baitSaver: 0.12 } },
  { lvl: 13, name: 'Steady Wrist',     desc: 'Fish hold the bite a moment longer.', fx: { stability: 0.06 } },
  { lvl: 15, name: 'Hotspot Sense',    desc: 'You can feel bubbling hotspots from further away.', fx: { hotspot: 1 } },
  { lvl: 18, name: 'Wider Net',        desc: 'A longer bite window before fish slip away.', fx: { barSize: 0.06 } },
  { lvl: 20, name: 'Night Fisher',     desc: 'Rare luck up at night.', fx: { nightLuck: 0.1 } },
  { lvl: 25, name: 'Long Cast II',     desc: 'Cast even further.', fx: { power: 1 } },
  { lvl: 30, name: 'Double Hook',      desc: '5% chance to reel in two fish.', fx: { multiCatch: 0.05 } },
  { lvl: 35, name: 'Tension Control',  desc: 'A slipped bite sometimes holds on for a second chance.', fx: { tension: 0.1 } },
  { lvl: 40, name: 'Treasure Hunter',  desc: 'Junk is more often treasure.', fx: { treasure: 0.06 } },
  { lvl: 45, name: 'Long Cast III',    desc: 'Cast impressively far.', fx: { power: 1 } },
  { lvl: 50, name: 'Golden Hour',      desc: 'Bonus XP at dawn and dusk.', fx: { goldenHour: 0.25 } },
  { lvl: 55, name: 'Big Game',         desc: 'Fish you catch run larger.', fx: { sizeBonus: 0.1 } },
  { lvl: 60, name: 'Drowsy Reel',      desc: 'Unlocks Cozy Mode: bites hook themselves (slower, fewer rares). Toggle in Settings.', fx: { cozyMode: 1 } },
  { lvl: 65, name: 'Chum Master',      desc: 'Fish bite noticeably faster.', fx: { biteRate: 0.1 } },
  { lvl: 70, name: 'Abyss License',    desc: 'The dock captain will ferry you to the Abyssal Trench.', fx: { abyss: 1 } },
  { lvl: 75, name: 'Long Cast IV',     desc: 'Cast across small ponds.', fx: { power: 1 } },
  { lvl: 80, name: 'Legend Sense',     desc: 'Legendary fish luck up.', fx: { legendLuck: 0.12 } },
  { lvl: 85, name: 'Iron Line',        desc: 'A missed bite always holds on for one more chance.', fx: { tension: 0.12 } },
  { lvl: 90, name: 'Mythic Affinity',  desc: 'Mythic fish luck up.', fx: { mythicLuck: 0.12 } },
  { lvl: 95, name: 'Long Cast V',      desc: 'They cast bets on where your bobber lands.', fx: { power: 1 } },
  { lvl: 100, name: 'Master Angler',   desc: 'All fishing stats +5%. You glow a little.', fx: { masterAura: 0.05 } },
];

// Island buildings
export const BUILDINGS = {
  farm: {
    name: 'Bait Farm', icon: 'farm',
    desc: 'Grow rare baits over time. Upgrades add plots and speed.',
    levels: [
      { cost: 2500, plots: 2, speed: 1 },
      { cost: 12000, plots: 4, speed: 1.35 },
      { cost: 60000, plots: 6, speed: 1.8 },
    ],
  },
  workshop: {
    name: 'Workshop', icon: 'workshop',
    desc: 'Upgrade your fishing rod to higher tiers. Upgrades discount crafting.',
    levels: [
      { cost: 3000, discount: 0 },
      { cost: 20000, discount: 0.1 },
      { cost: 90000, discount: 0.2 },
    ],
  },
  brewery: {
    name: 'Brewery', icon: 'brewery',
    desc: 'Brew fishing potions from your catch. Upgrades brew extra doses.',
    levels: [
      { cost: 4000, doses: 1 },
      { cost: 25000, doses: 2 },
      { cost: 110000, doses: 3 },
    ],
  },
  shrine: {
    name: 'Tide Shrine', icon: 'shrine',
    desc: 'Pray once a day for a random fishing blessing.',
    levels: [
      { cost: 8000, power: 0.1 },
      { cost: 40000, power: 0.18 },
      { cost: 160000, power: 0.3 },
    ],
  },
};

// Portal spots where the Island Broker can anchor your island portal.
export const PORTAL_SPOTS = [
  { id: 'town_square', name: 'Willowbrook Square', zone: 'town', x: 30, z: 40 },
  { id: 'pond_meadow', name: 'Meadow Ponds', zone: 'overworld', x: -320, z: 260 },
  { id: 'river_bend', name: 'Silverstream Bend', zone: 'overworld', x: -60, z: -180 },
  { id: 'lake_shore', name: 'Lake Umber Shore', zone: 'overworld', x: 380, z: -320 },
  { id: 'coast_dunes', name: 'Saltwind Dunes', zone: 'overworld', x: 240, z: 520 },
  { id: 'docks_edge', name: 'Driftwood Docks', zone: 'overworld', x: 480, z: 420 },
  { id: 'swamp_hollow', name: 'Murkfen Hollow', zone: 'overworld', x: -520, z: 80 },
  { id: 'glacier_foot', name: 'Frostpeak Foot', zone: 'overworld', x: -380, z: -520 },
];

// Junk & treasure tables
export const JUNK = [
  { name: 'Soggy Boot' }, { name: 'Rusty Can' },
  { name: 'Tangled Kelp' }, { name: 'Broken Bottle' },
  { name: 'Waterlogged Plank' }, { name: 'Old Tire' },
];
export const TREASURE = [
  { name: 'Copper Locket', value: 120 },
  { name: 'Pearl', value: 400 },
  { name: 'Silver Compass', value: 900 },
  { name: 'Gold Doubloon', value: 2200 },
  { name: 'Sunken Crown', value: 8000 },
];

// XP awarded per catch, by rarity (scaled by size roll and bonuses)
export const XP_BY_RARITY = {
  common: 12, uncommon: 26, rare: 62, epic: 165,
  legendary: 430, mythic: 1150, transcendent: 6000,
};
// Base coin value per rarity (scaled by size + fish-specific variance)
export const PRICE_BY_RARITY = {
  common: 8, uncommon: 22, rare: 65, epic: 210,
  legendary: 700, mythic: 2400, transcendent: 15000,
};

// Achievement claim rewards by tier
export const ACH_REWARD = { bronze: 100, silver: 400, gold: 1500, platinum: 6000, mythic: 25000 };

// Size classes: [minLen, maxLen] cm — weight derived from length
export const SIZE_CLASS = {
  tiny: [3, 12], small: [10, 30], medium: [25, 70],
  large: [60, 140], huge: [120, 300], colossal: [250, 900],
};
