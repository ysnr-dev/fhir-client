import { useState } from "react";
import type { NursingStandardPlan, NursingTaxonomy, NursingTerm } from "../api/masterClient";
import {
  useNursingStandardPlanSearch,
  useNursingStandardPlans,
  useNursingStandardPlansWithoutDiagnosis,
  useNursingTermChildren,
  useNursingTermSearch,
} from "../api/masterQueries";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 看護計画の立案で使う用語の選択。看護診断・看護成果・看護介入・標準看護計画とも件数が多いので、
// 「領域 → 類 → 用語(標準看護計画は看護診断の領域・類の下)」を列でたどって選ぶ。名称を入れると階層をまたいで探す。
// 列ごとに 1 階層ぶんだけ引く(全件を一度に読まない)。
//
// <form> は書かない(Modal はポータルではなく、立案フォームの中で開くと入れ子になる)。

/** 看護診断に結びつかない標準看護計画をまとめる、領域の列の末尾の行。 */
const NO_DIAGNOSIS = "__none__";

interface ColumnItem {
  key: string;
  label: string;
  note?: string;
}

function Column({
  title,
  items,
  selectedKey,
  loading,
  onSelect,
}: {
  title: string;
  items: ColumnItem[];
  selectedKey?: string;
  loading?: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="nursing-picker__column">
      <div className="nursing-picker__column-title">{title}</div>
      <ul className="nursing-picker__list">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={`nursing-picker__item${item.key === selectedKey ? " nursing-picker__item--selected" : ""}`}
              onClick={() => onSelect(item.key)}
            >
              {item.label}
              {item.note && <span className="nursing-picker__note">{item.note}</span>}
            </button>
          </li>
        ))}
        {loading && <li className="nursing-picker__empty">読み込み中...</li>}
        {!loading && items.length === 0 && <li className="nursing-picker__empty">-</li>}
      </ul>
    </div>
  );
}

function termItems(terms: NursingTerm[] | undefined): ColumnItem[] {
  return (terms ?? []).map((t) => ({ key: t.code, label: t.name }));
}

const TERM_LABELS: Record<NursingTaxonomy, string> = {
  diagnosis: "看護診断",
  outcome: "看護成果",
  intervention: "看護介入",
};

/** 看護診断・看護成果・看護介入の用語を選ぶ。 */
export function NursingTermPickerModal({
  taxonomy,
  onSelect,
  onClose,
}: {
  taxonomy: NursingTaxonomy;
  onSelect: (term: NursingTerm) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [klass, setKlass] = useState("");
  const q = query.trim();
  const label = TERM_LABELS[taxonomy];
  const domains = useNursingTermChildren(taxonomy, "domain", "");
  const classes = useNursingTermChildren(taxonomy, "class", domain);
  const terms = useNursingTermChildren(taxonomy, "term", klass);
  const search = useNursingTermSearch(taxonomy, q);

  function pick(list: NursingTerm[] | undefined, code: string) {
    const term = list?.find((t) => t.code === code);
    if (term) onSelect(term);
  }

  return (
    <Modal title={`${label}を選択`} onClose={onClose} className="modal--lab-order-item">
      <input
        type="search"
        className="nursing-picker__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={`${label}を検索`}
      />
      <ErrorBanner error={domains.error ?? classes.error ?? terms.error ?? search.error} />
      {q ? (
        <div className="nursing-picker__columns">
          <Column
            title="検索結果"
            items={(search.data?.items ?? []).map((t) => ({ key: t.code, label: t.name, note: t.code }))}
            loading={search.isFetching && !search.data}
            onSelect={(code) => pick(search.data?.items, code)}
          />
        </div>
      ) : (
        <div className="nursing-picker__columns">
          <Column
            title="領域"
            items={termItems(domains.data)}
            selectedKey={domain}
            loading={domains.isPending}
            onSelect={(code) => {
              setDomain(code);
              setKlass("");
            }}
          />
          <Column
            title="類"
            items={termItems(classes.data)}
            selectedKey={klass}
            loading={Boolean(domain) && classes.isPending}
            onSelect={setKlass}
          />
          <Column
            title={label}
            items={termItems(terms.data)}
            loading={Boolean(klass) && terms.isPending}
            onSelect={(code) => pick(terms.data, code)}
          />
        </div>
      )}
    </Modal>
  );
}

/**
 * 標準看護計画を選ぶ。計画は結びついた看護診断の「領域 → 類」でたどり、看護診断に結びつかない計画は
 * 領域の列の末尾「看護診断なし」にまとめる。
 */
export function NursingStandardPlanPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (plan: NursingStandardPlan) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [klass, setKlass] = useState("");
  const q = query.trim();
  const noDiagnosis = domain === NO_DIAGNOSIS;
  const domains = useNursingTermChildren("diagnosis", "domain", "");
  const classes = useNursingTermChildren("diagnosis", "class", noDiagnosis ? "" : domain);
  const terms = useNursingTermChildren("diagnosis", "term", klass);
  const termCodes = (terms.data ?? []).map((t) => t.code);
  const plansInClass = useNursingStandardPlans(termCodes, Boolean(klass) && termCodes.length > 0);
  const plansWithout = useNursingStandardPlansWithoutDiagnosis(noDiagnosis);
  const search = useNursingStandardPlanSearch(q);

  const diagnosisName = (code: string | null) => terms.data?.find((t) => t.code === code)?.name ?? "";
  const planItems = (plans: NursingStandardPlan[] | undefined, withDiagnosis: boolean): ColumnItem[] =>
    (plans ?? [])
      .filter((p) => p.active)
      .map((p) => ({ key: p.code, label: p.name, note: withDiagnosis ? diagnosisName(p.diagnosis_code) : undefined }));

  function pick(plans: NursingStandardPlan[] | undefined, code: string) {
    const plan = plans?.find((p) => p.code === code);
    if (plan) onSelect(plan);
  }

  return (
    <Modal title="標準看護計画を選択" onClose={onClose} className="modal--lab-order-item">
      <input
        type="search"
        className="nursing-picker__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="標準看護計画を検索"
      />
      <ErrorBanner
        error={domains.error ?? classes.error ?? terms.error ?? plansInClass.error ?? plansWithout.error ?? search.error}
      />
      {q ? (
        <div className="nursing-picker__columns">
          <Column
            title="検索結果"
            items={(search.data?.items ?? []).map((p) => ({ key: p.code, label: p.name, note: p.code }))}
            loading={search.isFetching && !search.data}
            onSelect={(code) => pick(search.data?.items, code)}
          />
        </div>
      ) : (
        <div className="nursing-picker__columns">
          <Column
            title="領域"
            items={[...termItems(domains.data), { key: NO_DIAGNOSIS, label: "看護診断なし" }]}
            selectedKey={domain}
            loading={domains.isPending}
            onSelect={(code) => {
              setDomain(code);
              setKlass("");
            }}
          />
          {noDiagnosis ? (
            <Column
              title="標準看護計画"
              items={planItems(plansWithout.data?.items, false)}
              loading={plansWithout.isPending}
              onSelect={(code) => pick(plansWithout.data?.items, code)}
            />
          ) : (
            <>
              <Column
                title="類"
                items={termItems(classes.data)}
                selectedKey={klass}
                loading={Boolean(domain) && classes.isPending}
                onSelect={setKlass}
              />
              <Column
                title="標準看護計画"
                items={planItems(plansInClass.data?.items, true)}
                loading={Boolean(klass) && (terms.isPending || (termCodes.length > 0 && plansInClass.isPending))}
                onSelect={(code) => pick(plansInClass.data?.items, code)}
              />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
