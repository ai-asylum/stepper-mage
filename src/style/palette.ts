/**
 * Book + chapter palette, ported from ai-asylum/spellbook's style/palette.ts so
 * the grimoire keeps its exact identity: plum leather, gold trim, parchment.
 */
export const chapters = {
  elementalism: 0xd4643a, // flame-warm terracotta
  transmutation: 0x8b5cf6, // arcane violet
  animancy: 0x7f9c3e,      // necrotic olive
} as const;

export const book = {
  leather: 0x7c3b52,   // deep magenta-plum leather
  leatherDark: 0x5a2a3c,
  spine: 0x4a2232,
  trim: 0xffc23e,      // gold corners + clasp
  pageFace: 0xfdf3dc,  // parchment
  pageEdge: 0xe6cf9f,  // stacked page edges
  ink: 0x3d2e50,
  ribbon: 0xd4523e,
} as const;

export const gold = 0xffc23e;
