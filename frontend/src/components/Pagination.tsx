interface PaginationProps {
  offset: number;
  count: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function Pagination({ offset, count, total, hasPrevious, hasNext, onPrevious, onNext }: PaginationProps) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + count, total);

  return (
    <div className="pagination">
      <button type="button" onClick={onPrevious} disabled={!hasPrevious}>
        前へ
      </button>
      <span className="pagination__status">
        {from}–{to} 件 / 全 {total} 件
      </span>
      <button type="button" onClick={onNext} disabled={!hasNext}>
        次へ
      </button>
    </div>
  );
}
