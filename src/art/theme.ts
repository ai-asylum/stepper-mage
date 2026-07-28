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

  /** Prop + enemy + boss sprite ids for this floor (see art/manifest.json). */
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
];

export function themeForDepth(depth: number): Theme {
  return THEMES[Math.max(0, Math.min(THEMES.length - 1, depth - 1))];
}
