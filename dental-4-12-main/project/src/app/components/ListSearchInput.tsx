import { Search } from 'lucide-react';

type ListSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export const ListSearchInput = ({
  value,
  onChange,
  placeholder = 'Search student, grade, or section...',
}: ListSearchInputProps) => (
  <label className="relative min-w-[320px] flex-1 sm:flex-none">
    <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </label>
);
