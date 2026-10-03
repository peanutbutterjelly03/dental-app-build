import { getGradeColor } from '../utils/gradeColors';

type GradePillProps = {
  grade: string;
  className?: string;
};

export const GradePill = ({ grade, className = '' }: GradePillProps) => {
  const gc = getGradeColor(grade);

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-none ${className}`.trim()}
      style={{ backgroundColor: gc.light, color: gc.solid }}
    >
      {grade}
    </span>
  );
};
