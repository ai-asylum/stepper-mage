/**
 * Floor themes — the palette + material identity of each dungeon level.
 *
 * Every floor must be recognisable from a single screenshot with the UI cropped
 * off. That means three things change per floor, not one: the masonry palette,
 * the light colour (torch vs furnace vs starlight), and the *detail vocabulary*
 * stamped into the walls (waterline stains vs bone inlay vs rivets vs gold).
 */
import { hex, type Col, Ramp } from './pixel';

export type FloorDetail =
  | 'waterline'   // drowned library: tide stains + swollen timber
  | 'bone'        // ossuary: bone inlay + soot
  | 'moss'        // verdant rot: creeping moss + root cracks
  | 'rivet'       // foundry: riveted plate + lava seams
  | 'inlay';      // celestial: gold constellation inlay

/**
 * Floors 6-10 REUSE these five vocabularies rather than adding five more.
 *
 * A vocabulary is not a name — it is a stamping pass in `tiles.ts` plus a table of
 * constants for all four texel densities in `steps.ts`. Five new ones is its own
 * phase of art work, and shipping five `FloorDetail` values that mapped to nothing
 * would be worse than reusing: the floors would draw bare masonry and read as
 * unfinished rather than as themed.
 *
 * Each is paired on fit, and the PALETTE is what actually separates the ten floors —
 * every one of them has its own ramps, accent, light colour and fog:
 *   6  Glass Gardens  -> inlay      polished sheen and rings read as cut glass
 *   7  Tidal Vault    -> waterline  a tide mark and algae, which is literally it
 *   8  Choir          -> bone       inlay and soot over flesh-toned stone
 *   9  Ashfall Reach  -> rivet      plate and seams for a dead industrial volcano
 *   10 Hollow Crown   -> inlay      gold constellation seams over black glass
 *
 * Two pairs share a pass (6 with 10) and are told apart by palette alone, which is
 * the honest cost of not building the art first.
 */

export interface Theme {
  id: string;
  /** Display name, shown on the floor card. */
  name: string;
  /** Roman-ish depth label. */
  depth: number;

  /** Masonry ramps: wall face, floor, ceiling. */
  wall: Ramp;
  floor: Ramp;
  ceil: Ramp;
  /** Mortar / recess colour between blocks. */
  mortar: Col;

  /** The floor's signature accent — glowing bits, decals, altar light. */
  accent: Col;
  accentDeep: Col;

  /** Player torch colour + how far it reaches (in tiles). */
  lightCol: Col;
  lightReach: number;
  /** Fog colour the corridor fades into. */
  fog: Col;
  /** Ambient floor added to baked light so pitch black is never pure black. */
  ambient: number;
  /**
   * Colour of that ambient. Warm torch + COOL ambient is what gives the frame
   * hue separation; a scalar ambient just makes everything one muddy tint.
   */
  ambientCol: Col;

  detail: FloorDetail;

  /**
   * Prop + enemy + boss sprite ids for this floor (see art/manifest.json).
   *
   * `props` and `golems` are INDEX-PAIRED — `populate.ts` rolls one index and reads
   * both — so they must stay the same length and the same order. Which element a
   * prop can be harvested for is deliberately not a third array here: it is keyed
   * by sprite id in `PROP_ELEMENT` (`spells/spells.ts`, beside `BODY_NAME`), so
   * there is nothing extra to keep aligned.
   */
  props: string[];
  golems: string[];
  enemies: string[];
  boss: string;
}

export const THEMES: Theme[] = [
  {
    id: 'library',
    name: 'The Drowned Library',
    depth: 1,
    wall: Ramp.build(0x241a26, 0x8a6f5c, 6, 0x5a4340),
    floor: Ramp.build(0x1b1620, 0x6b5a54, 6, 0x3d3138),
    ceil: Ramp.build(0x120e18, 0x352a36, 5),
    mortar: hex(0x140f1a),
    accent: hex(0xb98cff),
    accentDeep: hex(0x4a2f7a),
    lightCol: hex(0xffc27a),
    lightReach: 6.2,
    fog: hex(0x0b0812),
    ambient: 0.160,
    ambientCol: hex(0x4a5aa8),
    detail: 'waterline',
    props: ['f1_prop_bookshelf', 'f1_prop_candelabra', 'f1_prop_barrel', 'f1_prop_lectern'],
    golems: ['g_f1_bookshelf', 'g_f1_candelabra', 'g_f1_barrel', 'g_f1_lectern'],
    enemies: ['f1_enemy_ink', 'f1_enemy_moth', 'f1_enemy_wraith'],
    boss: 'f1_boss',
  },
  {
    id: 'ossuary',
    name: 'The Ossuary Kitchens',
    depth: 2,
    wall: Ramp.build(0x2a1c18, 0x9c8465, 6, 0x63483a),
    floor: Ramp.build(0x1e1512, 0x7a6248, 6, 0x453329),
    ceil: Ramp.build(0x150e0c, 0x3a2a22, 5),
    mortar: hex(0x160e0b),
    accent: hex(0xffd24a),
    accentDeep: hex(0x8a3a1e),
    lightCol: hex(0xffb457),
    lightReach: 6.6,
    fog: hex(0x0e0805),
    ambient: 0.140,
    ambientCol: hex(0x2f3a58),
    detail: 'bone',
    props: ['f2_prop_cauldron', 'f2_prop_meatrack', 'f2_prop_bonepile', 'f2_prop_alebarrel'],
    golems: ['g_f2_cauldron', 'g_f2_meatrack', 'g_f2_bonepile', 'g_f2_alebarrel'],
    enemies: ['f2_enemy_cleaver', 'f2_enemy_imp', 'f2_enemy_hound'],
    boss: 'f2_boss',
  },
  {
    id: 'verdant',
    name: 'The Verdant Rot',
    depth: 3,
    wall: Ramp.build(0x18201a, 0x74836a, 6, 0x3f4c3c),
    floor: Ramp.build(0x141a15, 0x5d6a52, 6, 0x2e3a2c),
    ceil: Ramp.build(0x0d120f, 0x2a3428, 5),
    mortar: hex(0x0d120e),
    accent: hex(0x9dff6e),
    accentDeep: hex(0x2f6b2a),
    lightCol: hex(0xd6ff9e),
    lightReach: 5.9,
    fog: hex(0x070c08),
    ambient: 0.180,
    ambientCol: hex(0x2c5a5e),
    detail: 'moss',
    props: ['f3_prop_fungus', 'f3_prop_root', 'f3_prop_statue', 'f3_prop_planter'],
    golems: ['g_f3_fungus', 'g_f3_root', 'g_f3_statue', 'g_f3_planter'],
    enemies: ['f3_enemy_hulk', 'f3_enemy_creeper', 'f3_enemy_priest'],
    boss: 'f3_boss',
  },
  {
    id: 'foundry',
    name: 'The Brass Foundry',
    depth: 4,
    wall: Ramp.build(0x201512, 0x8f6b48, 6, 0x543527),
    floor: Ramp.build(0x1a1210, 0x6b4d35, 6, 0x3b2419),
    ceil: Ramp.build(0x140c0a, 0x33211a, 5),
    mortar: hex(0x120a08),
    accent: hex(0xff8a2b),
    accentDeep: hex(0x9c2f08),
    lightCol: hex(0xff9440),
    lightReach: 5.4,
    fog: hex(0x0f0603),
    ambient: 0.150,
    ambientCol: hex(0x2a3a6e),
    detail: 'rivet',
    props: ['f4_prop_forge', 'f4_prop_gears', 'f4_prop_oildrum', 'f4_prop_hoist'],
    golems: ['g_f4_forge', 'g_f4_gears', 'g_f4_oildrum', 'g_f4_hoist'],
    enemies: ['f4_enemy_slag', 'f4_enemy_bellows', 'f4_enemy_wasp'],
    boss: 'f4_boss',
  },
  {
    id: 'vault',
    name: 'The Celestial Vault',
    depth: 5,
    wall: Ramp.build(0x151830, 0x7480b0, 6, 0x394272),
    floor: Ramp.build(0x101226, 0x5a6390, 6, 0x2a2f56),
    ceil: Ramp.build(0x080a18, 0x232a4e, 5),
    mortar: hex(0x0a0c1c),
    accent: hex(0xffe58a),
    accentDeep: hex(0x4a5ccc),
    lightCol: hex(0xbcd4ff),
    lightReach: 6.6,
    fog: hex(0x05060f),
    ambient: 0.200,
    ambientCol: hex(0x3646a8),
    detail: 'inlay',
    props: ['f5_prop_orrery', 'f5_prop_telescope', 'f5_prop_crystal', 'f5_prop_font'],
    golems: ['g_f5_orrery', 'g_f5_telescope', 'g_f5_crystal', 'g_f5_font'],
    enemies: ['f5_enemy_acolyte', 'f5_enemy_husk', 'f5_enemy_sentinel'],
    boss: 'f5_boss',
  },
  {
    id: 'gardens',
    name: 'The Glass Gardens',
    depth: 6,
    wall: Ramp.build(0x14201c, 0x6f9a86, 6, 0x3c5c50),
    floor: Ramp.build(0x101a18, 0x5c806f, 6, 0x2e4640),
    ceil: Ramp.build(0x0a1211, 0x24352f, 5),
    mortar: hex(0x0c1614),
    accent: hex(0x8cf0c4),
    accentDeep: hex(0x1f7a5c),
    lightCol: hex(0xc8f0d8),
    lightReach: 7.0,
    fog: hex(0x061010),
    ambient: 0.185,
    ambientCol: hex(0x2f7a86),
    detail: 'inlay',
    props: ['f6_prop_pane', 'f6_prop_cloche', 'f6_prop_trough', 'f6_prop_lantern'],
    golems: ['g_f6_pane', 'g_f6_cloche', 'g_f6_trough', 'g_f6_lantern'],
    enemies: ['f6_enemy_bloom', 'f6_enemy_shard', 'f6_enemy_gardener'],
    boss: 'f6_boss',
  },
  {
    id: 'tidal',
    name: 'The Tidal Vault',
    depth: 7,
    wall: Ramp.build(0x101a24, 0x5d7c96, 6, 0x2f4a60),
    floor: Ramp.build(0x0c1620, 0x4e6a80, 6, 0x243a4e),
    ceil: Ramp.build(0x070e15, 0x1e2c3a, 5),
    mortar: hex(0x08111a),
    accent: hex(0xffd06a),
    accentDeep: hex(0x8a5a12),
    lightCol: hex(0x9ec8e8),
    lightReach: 5.8,
    fog: hex(0x030810),
    ambient: 0.150,
    ambientCol: hex(0x1d4a72),
    detail: 'waterline',
    props: ['f7_prop_hoard', 'f7_prop_coral', 'f7_prop_strongbox', 'f7_prop_anchor'],
    golems: ['g_f7_hoard', 'g_f7_coral', 'g_f7_strongbox', 'g_f7_anchor'],
    enemies: ['f7_enemy_drowned', 'f7_enemy_crab', 'f7_enemy_eel'],
    boss: 'f7_boss',
  },
  {
    id: 'choir',
    name: 'The Choir of Wounds',
    depth: 8,
    wall: Ramp.build(0x1e1218, 0x9c7068, 6, 0x5e3a3a),
    floor: Ramp.build(0x170e12, 0x805a54, 6, 0x462a2c),
    ceil: Ramp.build(0x0f080c, 0x2e1c20, 5),
    mortar: hex(0x120a0e),
    accent: hex(0xff8fa8),
    accentDeep: hex(0x8a1f3a),
    lightCol: hex(0xffc0b0),
    lightReach: 6.0,
    fog: hex(0x0a0508),
    ambient: 0.135,
    ambientCol: hex(0x5a2a44),
    detail: 'bone',
    props: ['f8_prop_pulpit', 'f8_prop_bell', 'f8_prop_organ', 'f8_prop_censer'],
    golems: ['g_f8_pulpit', 'g_f8_bell', 'g_f8_organ', 'g_f8_censer'],
    enemies: ['f8_enemy_cantor', 'f8_enemy_bellman', 'f8_enemy_hymn'],
    boss: 'f8_boss',
  },
  {
    id: 'ashfall',
    name: 'The Ashfall Reach',
    depth: 9,
    wall: Ramp.build(0x18181a, 0x8e8c88, 6, 0x54524e),
    floor: Ramp.build(0x131314, 0x76736e, 6, 0x3e3c3a),
    ceil: Ramp.build(0x0c0c0d, 0x282726, 5),
    mortar: hex(0x0e0e0f),
    accent: hex(0xff7a3c),
    accentDeep: hex(0x7a2a0c),
    lightCol: hex(0xd8cfc4),
    lightReach: 5.2,
    fog: hex(0x0a0a0a),
    ambient: 0.170,
    ambientCol: hex(0x4a4a52),
    detail: 'rivet',
    props: ['f9_prop_column', 'f9_prop_kiln', 'f9_prop_bellows', 'f9_prop_cairn'],
    golems: ['g_f9_column', 'g_f9_kiln', 'g_f9_bellows', 'g_f9_cairn'],
    enemies: ['f9_enemy_cinder', 'f9_enemy_obsidian', 'f9_enemy_mourner'],
    boss: 'f9_boss',
  },
  {
    id: 'crown',
    name: 'The Hollow Crown',
    depth: 10,
    wall: Ramp.build(0x0c0a10, 0x4e4658, 6, 0x282232),
    floor: Ramp.build(0x08070c, 0x3e3848, 6, 0x1c1826),
    ceil: Ramp.build(0x050408, 0x18141e, 5),
    mortar: hex(0x060509),
    accent: hex(0xffd98a),
    accentDeep: hex(0x6a4a10),
    lightCol: hex(0xbfa8e0),
    lightReach: 4.8,
    fog: hex(0x020104),
    ambient: 0.120,
    ambientCol: hex(0x2a1c4a),
    detail: 'inlay',
    props: ['f10_prop_throne', 'f10_prop_banner', 'f10_prop_reliquary', 'f10_prop_brazier'],
    golems: ['g_f10_throne', 'g_f10_banner', 'g_f10_reliquary', 'g_f10_brazier'],
    enemies: ['f10_enemy_regent', 'f10_enemy_herald', 'f10_enemy_kingsguard'],
    boss: 'f10_boss',
  },
];

export function themeForDepth(depth: number): Theme {
  return THEMES[Math.max(0, Math.min(THEMES.length - 1, depth - 1))];
}
