const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return `${date.getDate()} ${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}

export default function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center justify-center my-3 select-none">
      <div className="px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800/80 backdrop-blur-sm">
        <span className="text-[11px] font-semibold text-slate-400 tracking-wide">
          {formatLabel(date)}
        </span>
      </div>
    </div>
  );
}
