import { useId, useState } from "react";
import { JsonBlock } from "./JsonBlock";

// FHIR リソースの JSON 表示。Bundle を渡したときだけ「Bundle 全体」と
// 「リソース単位」を切り替えられる。詳細ページの <details> 内と
// カルテ画面のモーダルの双方から使う。

type JsonView = "bundle" | "resource";

export function FhirJsonView({ resource }: { resource: fhir4.Resource | undefined }) {
  const [view, setView] = useState<JsonView>("bundle");
  // 1 ページに複数置いてもラジオが同じグループにならないよう name を一意にする。
  const groupName = useId();

  if (!resource) return null;

  const bundle = resource.resourceType === "Bundle" ? (resource as fhir4.Bundle) : undefined;
  if (!bundle) return <JsonBlock value={resource} />;

  return (
    <>
      <div className="prescription-detail__raw-toggle">
        <label>
          <input
            type="radio"
            name={groupName}
            checked={view === "bundle"}
            onChange={() => setView("bundle")}
          />
          Bundle
        </label>
        <label>
          <input
            type="radio"
            name={groupName}
            checked={view === "resource"}
            onChange={() => setView("resource")}
          />
          リソース単位
        </label>
      </div>

      {view === "bundle" ? (
        <JsonBlock value={bundle} />
      ) : (
        <div className="prescription-detail__raw-resources">
          {bundle.entry?.map((entry, index) => (
            <div className="prescription-detail__raw-resource" key={entry.resource?.id ?? index}>
              <h3>
                {entry.resource?.resourceType}
                {entry.resource?.id ? ` / ${entry.resource.id}` : ""}
              </h3>
              <JsonBlock value={entry.resource} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
