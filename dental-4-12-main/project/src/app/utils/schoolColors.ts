// School Color Coding System
// Each school has a unique color used consistently everywhere
//
// ⚠ Same accessibility correction as gradeColors.ts (Sprint 96): `solid` and
// `text` are painted on `light`, and two of the three were below 4.5:1 there.
// Darkened in HSL with hue held fixed. BT Integrated's blue already passed at
// 7.15:1 and is untouched. `border` is decorative and is left alone — WCAG's
// text rule does not apply to it.

export interface SchoolColor {
  name: string;
  solid: string;
  light: string;
  text: string;
  border: string;
}

export const SCHOOL_COLORS: Record<string, SchoolColor> = {
  'Bagong Tanyag Integrated School': {
    name: 'Bagong Tanyag Integrated School',
    solid: '#1E40AF',
    light: '#DBEAFE',
    text: '#1E40AF',
    border: '#93C5FD',
  },
  'Bagong Tanyag Elementary School Annex A': {
    name: 'Bagong Tanyag Elementary School Annex A',
    solid: '#0B7A70',
    light: '#CCFBF1',
    text: '#0B7A70',
    border: '#5EEAD4',
  },
  'South Daang Hari Elementary School Main': {
    name: 'South Daang Hari Elementary School Main',
    solid: '#BC470A',
    light: '#FFEDD5',
    text: '#BC470A',
    border: '#FDBA74',
  },
};

// Schools added through School Management have no entry above.
//
// Once the school list is known (`setSchoolRegistry`, called wherever /schools
// is fetched), each extra school in creation order takes the hue FARTHEST from
// every hue already in use, the three fixed colours included. So schools that
// sit next to each other are never in the same colour family, and a school
// keeps its colour when a later one is added. Each also gets one of three
// shades, so hues that end up close still read as different.
//
// Before the list is known, a colour generated from the name is used instead.
//
// Lightness is fixed per part (dark text on a pale fill) so text stays legible
// whatever the hue: measured over all 360 hues, text on fill is at least 4.9:1
// and the solid bar/icon colour at least 3:1 against white.
const SHADES = [
  { text: 18, solid: 26, border: 72 },
  { text: 22, solid: 30, border: 66 },
  { text: 26, solid: 34, border: 78 },
];

/** Approximate hues of the three fixed colours above (blue, teal, orange). */
const FIXED_HUES = [226, 174, 22];

const fromHue = (name: string, hue: number, shadeIndex: number): SchoolColor => {
  const shade = SHADES[shadeIndex % SHADES.length];
  return {
    name,
    solid: `hsl(${hue}, 72%, ${shade.solid}%)`,
    text: `hsl(${hue}, 72%, ${shade.text}%)`,
    light: `hsl(${hue}, 85%, 93%)`,
    border: `hsl(${hue}, 75%, ${shade.border}%)`,
  };
};

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

let registryColors = new Map<string, SchoolColor>();

/** Give every school in the registry its colour. Pass schools in creation order. */
export const setSchoolRegistry = (schools: { school_name: string }[]) => {
  const used = [...FIXED_HUES];
  const next = new Map<string, SchoolColor>();
  let k = 0;
  for (const { school_name } of schools) {
    if (SCHOOL_COLORS[school_name]) continue;
    let best = 0;
    let bestGap = -1;
    for (let h = 0; h < 360; h += 5) {
      const gap = Math.min(...used.map((u) => hueGap(h, u)));
      if (gap > bestGap) { best = h; bestGap = gap; }
    }
    used.push(best);
    next.set(school_name, fromHue(school_name, best, k));
    k += 1;
  }
  registryColors = next;
};

export const getSchoolColor = (school: string): SchoolColor => {
  const fixed = SCHOOL_COLORS[school] ?? registryColors.get(school);
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < school.length; i++) hash = (hash * 31 + school.charCodeAt(i)) >>> 0;
  return fromHue(school, hash % 360, Math.floor(hash / 360));
};

export const SCHOOL_SHORT_NAMES: Record<string, string> = {
  'Bagong Tanyag Integrated School': 'Bagong Tanyag Integrated',
  'Bagong Tanyag Elementary School Annex A': 'Bagong Tanyag Annex A',
  'South Daang Hari Elementary School Main': 'S. Daang Hari',
};

// Terser still than SCHOOL_SHORT_NAMES above — for spots too tight for even
// that (the topbar user menu, a table cell tag).
export const SCHOOL_ACRONYMS: Record<string, string> = {
  'Bagong Tanyag Integrated School': 'BTIS',
  'Bagong Tanyag Elementary School Annex A': 'Annex A',
  'South Daang Hari Elementary School Main': 'South Daanghari',
};

export const getSchoolAcronym = (school: string): string => {
  return SCHOOL_ACRONYMS[school] || school;
};

export const getSchoolShortName = (school: string): string => {
  return SCHOOL_SHORT_NAMES[school] || school;
};
