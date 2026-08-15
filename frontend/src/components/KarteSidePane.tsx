import { KarteCategoryList } from "./KarteCategoryList";
import { KarteDayList } from "./KarteDayList";
import type { KarteCardFilter, KarteDayGroup } from "../fhir/karteTimeline";
import type { KarteSidePaneMode } from "../karteLayout";

// カルテ左端のペイン。「診療日」(日付から探す)と「カテゴリ」(情報の種別で絞り込む)を
// 切り替えて使う。折りたたみはペイン全体に効く(中身がどちらでも意味が変わらないため)。

interface KarteSidePaneProps {
  /** 絞り込み後の診療日グループ。診療日ツリーもタイムラインと同じ範囲を出す。 */
  groups: KarteDayGroup[];
  onSelect: (targetKey: string) => void;
  mode: KarteSidePaneMode;
  onModeChange: (mode: KarteSidePaneMode) => void;
  filter: KarteCardFilter | null;
  onFilterChange: (filter: KarteCardFilter | null) => void;
  visible: boolean;
  onToggleVisible: () => void;
}

// ペインは 160px しかなく、スクロールバーが出ると表示切替アイコンの場所が足りなく
// なるため、ラベルは短く保つ。
const MODES: { key: KarteSidePaneMode; label: string }[] = [
  { key: "days", label: "診療日" },
  { key: "categories", label: "種別" },
];

export function KarteSidePane({
  groups,
  onSelect,
  mode,
  onModeChange,
  filter,
  onFilterChange,
  visible,
  onToggleVisible,
}: KarteSidePaneProps) {
  const visibilityButton = <VisibilityButton visible={visible} onToggle={onToggleVisible} />;

  // 非表示のときも切替ボタンだけは残さないと表示に戻せないので、細い帯にして残す。
  if (!visible) {
    return <div className="karte-daylist karte-daylist--collapsed">{visibilityButton}</div>;
  }

  return (
    <nav className="karte-daylist">
      <div className="karte-daylist__header">
        <div className="karte-sidepane__modes" role="tablist" aria-label="左ペインの表示">
          {MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={mode === item.key}
              className={`karte-sidepane__mode${mode === item.key ? " karte-sidepane__mode--active" : ""}`}
              onClick={() => onModeChange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {visibilityButton}
      </div>
      {mode === "days" ? (
        <KarteDayList groups={groups} onSelect={onSelect} />
      ) : (
        <KarteCategoryList filter={filter} onSelect={onFilterChange} />
      )}
    </nav>
  );
}

// ペインの表示・非表示を切り替えるアイコンボタン。
function VisibilityButton({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const label = visible ? "左ペインを隠す" : "左ペインを表示する";
  return (
    <button
      type="button"
      className={`karte-daylist__visibility${visible ? " karte-daylist__visibility--active" : ""}`}
      aria-pressed={visible}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        {/* 表示中は左カラムが出ているアイコン、非表示のときは 1 枚のアイコン。 */}
        {visible && <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
    </button>
  );
}
