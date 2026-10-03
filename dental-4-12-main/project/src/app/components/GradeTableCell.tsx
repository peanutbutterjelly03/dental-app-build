import { GradePill } from './GradePill';
import { studentListTableStyles } from './StudentListTableStyles';

type GradeTableCellProps = {
  grade: string;
};

export const GradeTableCell = ({ grade }: GradeTableCellProps) => (
  <td className={studentListTableStyles.secondaryCell}>
    <GradePill grade={grade} />
  </td>
);
