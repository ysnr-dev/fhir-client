import { useEffect, useState } from "react";
import { SurgeryCalendar, type CalendarMode } from "../components/SurgeryCalendar";
import { today } from "../lib/dates";

// 手術室カレンダー。手術部が**部屋の埋まり具合を見て日程を組む**ための画面。
//
// もとは手術一覧の 3 つ目のタブだったが、独立した画面にして部門業務メニューへ移した。
// 一覧(手術一覧)は「この日の手術を 1 件ずつ処理する」画面で、進捗を進めながら縦に
// 読む。カレンダーは「空いているところを探して入れる」画面で、部屋 × 時刻の面を横に
// 読む —— 使う場面も見る向きも違い、一覧の絞り込み(手術室・病棟・診療科・ステータス)は
// カレンダーでは 1 つも使っていなかった。タブに同居させる理由が無い。
//
// 日付と表示単位(日/週)はカレンダーの中の道具立てなので、この画面が持つ。読むクエリは
// 一覧と同じ useSurgeryWorklist なので、一覧を見た後に開いても読み直しは起きない。
//
// 格子・未確定リスト・ドラッグでの日程確定・空き枠からの登録は SurgeryCalendar 側。
// (docs/surgery-calendar-design.md)

export function SurgeryCalendarPage() {
  // 予定手術日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<CalendarMode>("day");

  // 手術室ぶんの列と右の未確定リストが並ぶので、この画面だけ幅を広げる
  // (手術一覧・カルテと同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <h1>手術カレンダー</h1>
      </div>

      <SurgeryCalendar
        date={date}
        // 日付を空にはさせない(空で検索すると全期間になってしまう)。
        onDateChange={(next) => {
          if (next) setDate(next);
        }}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}
