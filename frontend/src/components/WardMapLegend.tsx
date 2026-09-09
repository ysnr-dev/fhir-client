// 病棟マップの凡例。ベッドの色分けと、掴んで動かしたときの見え方。

export interface LegendItem {
  /** ベッドの見本に付ける修飾クラス(ward-map__bed--xxx)。 */
  modifier: string;
  label: string;
}

export function WardMapLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="ward-map__legend" aria-label="凡例">
      {items.map((item) => (
        <li key={item.modifier} className="ward-map__legend-item">
          <span className={`ward-map__legend-swatch ward-map__bed--${item.modifier}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
