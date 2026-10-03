// Grade Level Color Coding System
// Consistent colors used across all modules for visual hierarchy
//
// ⚠ THE `solid` VALUES ARE ACCESSIBILITY-CORRECTED (Sprint 96), NOT PICKED BY
// EYE. Each one is painted as TEXT on its own `light` background, and nine of
// the eleven fell below the WCAG AA 4.5:1 threshold there — Grade 9 was the
// worst at 2.85:1. Each was darkened in HSL with HUE AND SATURATION HELD FIXED
// until it reached 4.5:1, so a grade is still recognised by its colour; only
// lightness moved. Every value also clears 4.5:1 on white (4.93-7.90:1),
// because these chips appear on white surfaces too.
//
// If a colour is ever changed here, re-check it against BOTH backgrounds.
// `verify_sprint96.mjs` measures the rendered chips, so a regression fails.

export interface GradeColor {
  name: string;
  solid: string;
  light: string;
}

export const GRADE_COLORS: Record<string, GradeColor> = {
  'Kinder': {
    name: 'Kinder',
    solid: '#7C3AED',
    light: '#EDE9FE'
  },
  'Grade 1': {
    name: 'Grade 1',
    solid: '#C9226C',
    light: '#FCE7F3'
  },
  'Grade 2': {
    name: 'Grade 2',
    solid: '#BC470A',
    light: '#FFEDD5'
  },
  'Grade 3': {
    name: 'Grade 3',
    solid: '#A75C05',
    light: '#FEF3C7'
  },
  'Grade 4': {
    name: 'Grade 4',
    solid: '#11813B',
    light: '#DCFCE7'
  },
  'Grade 5': {
    name: 'Grade 5',
    solid: '#0B7A70',
    light: '#CCFBF1'
  },
  'Grade 6': {
    name: 'Grade 6',
    solid: '#1C5CEA',
    light: '#DBEAFE'
  },
  'Grade 7': {
    name: 'Grade 7',
    solid: '#4338CA',
    light: '#E0E7FF'
  },
  'Grade 8': {
    name: 'Grade 8',
    solid: '#077792',
    light: '#CFFAFE'
  },
  'Grade 9': {
    name: 'Grade 9',
    solid: '#4E7D0A',
    light: '#ECFCCB'
  },
  'Grade 10': {
    name: 'Grade 10',
    solid: '#CB1A41',
    light: '#FFE4E6'
  }
};

export const getGradeColor = (grade: string): GradeColor => {
  return GRADE_COLORS[grade] || {
    name: grade,
    solid: '#69707D',
    light: '#F3F4F6'
  };
};

export const getGradeSolidColor = (grade: string): string => {
  return getGradeColor(grade).solid;
};

export const getGradeLightColor = (grade: string): string => {
  return getGradeColor(grade).light;
};
