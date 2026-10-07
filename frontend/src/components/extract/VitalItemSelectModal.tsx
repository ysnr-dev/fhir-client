import { vitalChartItems, type ChartItem } from "../../fhir/chartDefinitionHelpers";
import { Modal } from "../Modal";

const VITAL_ITEMS = vitalChartItems();

interface Props {
  onSelect: (item: ChartItem) => void;
  onClose: () => void;
}

/** バイタルの項目を 1 件選ぶ(検査結果の抽出の列に足す)。 */
export function VitalItemSelectModal({ onSelect, onClose }: Props) {
  return (
    <Modal title="バイタル項目を選択" onClose={onClose} className="modal--vital-item">
      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {VITAL_ITEMS.map((item) => (
            <tr key={item.key} className="master-search__row" onClick={() => onSelect(item)}>
              <td>{item.name}</td>
              <td>{item.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
