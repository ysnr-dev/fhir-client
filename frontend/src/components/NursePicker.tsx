import { useState } from "react";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// 担当看護師の複数選択。セレクトで 1 人ずつ足して下にチップで並べる。
// select multiple は Ctrl 押しながらのクリックが要って選び方が見て分からないため
// 使わない。入院登録・入院予定・入院実施の各モーダルで共用する。

export function NursePicker({
  practitioners,
  nurseIds,
  onChange,
}: {
  practitioners: fhir4.Practitioner[];
  nurseIds: string[];
  onChange: (nurseIds: string[]) => void;
}) {
  // 選択中の値。追加したら空に戻すので nurseIds とは別に持つ。
  const [pick, setPick] = useState("");

  function add(id: string) {
    if (!id) return;
    if (!nurseIds.includes(id)) onChange([...nurseIds, id]);
    // 追加したらセレクトは「選択してください」に戻す。続けて次の人を選べる。
    setPick("");
  }

  function name(id: string): string {
    const found = practitioners.find((p) => p.id === id);
    return found ? practitionerDisplayName(found) : id;
  }

  return (
    <div className="admission__nurses">
      <label>
        担当看護師
        <div className="admission__nurse-pick">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">看護師を選択</option>
            {practitioners
              // 選んだ人はセレクトから消して、二重に足せないようにする。
              .filter((p) => !nurseIds.includes(p.id as string))
              .map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitionerDisplayName(practitioner)}
                </option>
              ))}
          </select>
          <button type="button" onClick={() => add(pick)} disabled={!pick}>
            追加
          </button>
        </div>
      </label>

      {nurseIds.length > 0 && (
        <ul className="admission__nurse-chips">
          {nurseIds.map((id) => (
            <li key={id}>
              {name(id)}
              <button
                type="button"
                className="order-select__remove"
                onClick={() => onChange(nurseIds.filter((n) => n !== id))}
                aria-label={`${name(id)} を担当から外す`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
