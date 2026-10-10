import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useAcuityRecords, useSaveAcuity } from "../api/queries";
import {
  acuityCriterionLabel,
  acuityFormOf,
  acuityScores,
  acuitySuggestions,
  buildAcuityObservation,
  initialAcuityValues,
  meetsAcuityCriterion,
  parseAcuityObservation,
  type AcuityGroup,
  type AcuityItem,
  type AcuitySuggestion,
  type AcuityValues,
  type NursingAcuitySettings,
} from "../fhir/nursingAcuityHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  patientId: string;
  patientName: string;
  encounter: fhir4.Encounter;
  date: string;
  ward: { wardId: string; wardName: string } | null;
  settings: NursingAcuitySettings;
  /** その日の評価(あれば編集)。 */
  existing?: fhir4.Observation;
  /** 前日の評価(B 項目の初期値と「前日複写」に使う)。 */
  previous?: fhir4.Observation;
  /** 保存できたとき(閉じる前に呼ぶ)。一括入力のグリッドがその行の入力途中の値を捨てるのに使う。 */
  onSaved?: () => void;
  onClose: () => void;
}

const GROUP_LABELS: Record<AcuityGroup, string> = {
  A: "A モニタリング及び処置等",
  B: "B 患者の状況等",
  C: "C 手術等の医学的状況",
};

// 看護必要度の 1 日分の評価(docs/nursing-acuity-design.md)。
//
// 新しく書くときの初期値は、B は前日の評価(患者の状況は日ごとに大きく変わらないため)、A は
// 実施記録から推した項目(acuitySuggestions)。どちらも看護師が確かめて直す前提で、推した項目には
// 根拠を添える。評価票の版は既存の評価があればその版、無ければ施設設定の版。
export function NursingAcuityModal(props: Props) {
  const records = useAcuityRecords(props.patientId, props.date);
  return (
    <Modal title={`看護必要度 - ${props.patientName}(${props.date})`} onClose={props.onClose} className="nursing-acuity-modal">
      <ErrorBanner error={records.error} />
      {records.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <AcuityForm
          {...props}
          {...acuitySuggestions({
            date: props.date,
            encounter: props.encounter,
            procedures: records.data?.procedures ?? [],
            administrations: records.data?.administrations ?? [],
          })}
        />
      )}
    </Modal>
  );
}

function AcuityForm({
  patientId,
  encounter,
  date,
  ward,
  settings,
  existing,
  previous,
  suggestions,
  hints,
  onSaved,
  onClose,
}: Props & { suggestions: AcuitySuggestion[]; hints: string[] }) {
  const save = useSaveAcuity();
  const me = useCurrentPractitioner();
  const form = existing ? parseAcuityObservation(existing).form : acuityFormOf(settings.form);

  const [values, setValues] = useState<AcuityValues>(() =>
    existing ? parseAcuityObservation(existing).values : initialAcuityValues(previous, suggestions),
  );

  const scores = useMemo(() => acuityScores(form, values), [form, values]);
  const reasonByCode = new Map(suggestions.map((s) => [s.code, s.reason]));
  const ratio1 = meetsAcuityCriterion(scores, settings.ratio1);
  const ratio2 = meetsAcuityCriterion(scores, settings.ratio2);

  function toggle(code: string, on: boolean) {
    setValues((prev) => ({
      ...prev,
      checks: on ? [...new Set([...prev.checks, code])] : prev.checks.filter((c) => c !== code),
    }));
  }

  function copyPrevious() {
    if (!previous) return;
    setValues(parseAcuityObservation(previous).values);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const observation = buildAcuityObservation({
      form,
      values,
      patientId,
      encounterId: encounter.id ?? "",
      date,
      ward,
      performer: me.practitionerId && me.practitioner
        ? { id: me.practitionerId, name: practitionerDisplayName(me.practitioner) }
        : null,
      existing,
    });
    save.mutate(observation, {
      onSuccess: () => {
        onSaved?.();
        onClose();
      },
    });
  }

  const groups: AcuityGroup[] = ["A", "B", "C"];
  return (
    <form className="nursing-acuity" onSubmit={handleSubmit}>
      <ErrorBanner error={save.error} />
      <div className="nursing-acuity__summary">
        <span>A {scores.A}点</span>
        <span>B {scores.B}点</span>
        <span>C {scores.C}点</span>
        {ratio1 !== null && (
          <span className={ratio1 ? "nursing-acuity__met" : undefined} title={acuityCriterionLabel(settings.ratio1)}>
            割合1 {ratio1 ? "該当" : "非該当"}
          </span>
        )}
        {ratio2 !== null && (
          <span className={ratio2 ? "nursing-acuity__met" : undefined} title={acuityCriterionLabel(settings.ratio2)}>
            割合2 {ratio2 ? "該当" : "非該当"}
          </span>
        )}
        <label className="nursing-acuity__excluded">
          <input
            type="checkbox"
            checked={values.excluded}
            onChange={(e) => setValues((prev) => ({ ...prev, excluded: e.target.checked }))}
          />
          対象外
        </label>
      </div>

      {values.excluded ? (
        <label className="nursing-acuity__reason">
          理由
          <input
            type="text"
            value={values.excludedReason}
            onChange={(e) => setValues((prev) => ({ ...prev, excludedReason: e.target.value }))}
          />
        </label>
      ) : (
        groups.map((group) => (
          <section key={group} className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>{GROUP_LABELS[group]}</h3>
              <span className="nursing-acuity__group-score">{scores[group]}点</span>
            </div>
            {group === "C" && hints.length > 0 && (
              <ul className="nursing-acuity__hints">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            )}
            <table className="nursing-acuity__table">
              <tbody>
                {form.items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <ItemRow
                      key={item.code}
                      item={item}
                      values={values}
                      reasonByCode={reasonByCode}
                      onToggle={toggle}
                      onState={(code, index) =>
                        setValues((prev) => ({ ...prev, states: { ...prev.states, [code]: index } }))
                      }
                      onAssist={(code, on) =>
                        setValues((prev) => ({ ...prev, assists: { ...prev.assists, [code]: on } }))
                      }
                    />
                  ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      <div className="prescription-form__actions">
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? "登録中..." : "登録"}
        </button>
        {previous && !existing && (
          <button type="button" onClick={copyPrevious} disabled={save.isPending}>
            前日複写
          </button>
        )}
        <button type="button" onClick={onClose} disabled={save.isPending}>
          取消
        </button>
      </div>
    </form>
  );
}

function ItemRow({
  item,
  values,
  reasonByCode,
  onToggle,
  onState,
  onAssist,
}: {
  item: AcuityItem;
  values: AcuityValues;
  reasonByCode: Map<string, string>;
  onToggle: (code: string, on: boolean) => void;
  onState: (code: string, index: number) => void;
  onAssist: (code: string, on: boolean) => void;
}) {
  const checked = new Set(values.checks);
  if (item.kind === "check") {
    return (
      <tr>
        <td className="nursing-acuity__number">{item.number}</td>
        <td>
          <label className="nursing-acuity__check">
            <input type="checkbox" checked={checked.has(item.code)} onChange={(e) => onToggle(item.code, e.target.checked)} />
            {item.label}
          </label>
          <Reason text={reasonByCode.get(item.code)} />
        </td>
        <td className="nursing-acuity__points">{item.points}点</td>
      </tr>
    );
  }
  if (item.kind === "choice") {
    return (
      <tr className="nursing-acuity__choice-row">
        <td className="nursing-acuity__number">{item.number}</td>
        <td colSpan={2}>
          {item.label}
          <ul className="nursing-acuity__options">
            {item.options.map((option, index) => (
              <li key={option.code}>
                <label className="nursing-acuity__check">
                  <input
                    type="checkbox"
                    checked={checked.has(option.code)}
                    onChange={(e) => onToggle(option.code, e.target.checked)}
                  />
                  {"①②③④⑤⑥⑦⑧⑨⑩⑪⑫"[index]} {option.label}
                </label>
                <span className="nursing-acuity__points">{option.points}点</span>
                <Reason text={reasonByCode.get(option.code)} />
              </li>
            ))}
          </ul>
        </td>
      </tr>
    );
  }
  const stateIndex = values.states[item.code] ?? 0;
  return (
    <tr>
      <td className="nursing-acuity__number">{item.number}</td>
      <td>{item.label}</td>
      <td className="nursing-acuity__state">
        <span className="nursing-acuity__choices" role="radiogroup" aria-label={item.label}>
          {item.states.map((s, index) => (
            <button
              key={s.label}
              type="button"
              role="radio"
              aria-checked={stateIndex === index}
              className={stateIndex === index ? "is-active" : undefined}
              onClick={() => onState(item.code, index)}
            >
              {s.label}
            </button>
          ))}
        </span>
        {item.assist && (
          <label className="nursing-acuity__check">
            <input
              type="checkbox"
              checked={Boolean(values.assists[item.code])}
              onChange={(e) => onAssist(item.code, e.target.checked)}
            />
            介助の実施
          </label>
        )}
      </td>
    </tr>
  );
}

/** 記録から推した根拠。 */
function Reason({ text }: { text: string | undefined }) {
  return text ? <span className="nursing-acuity__reason-tag">記録: {text}</span> : null;
}
