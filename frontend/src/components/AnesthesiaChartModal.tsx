import { AnesthesiaChartPanel } from "./AnesthesiaChartPanel";
import { Modal } from "./Modal";

// カルテのカードから開く麻酔チャート。中身は専用ページと同じパネルで、
// カルテを見ながら打点を足したり術中の経過を読み返したりするためのもの。
// グラフが横に伸びるので、モーダルの中でいちばん広い幅を使う。

interface AnesthesiaChartModalProps {
  orderId: string;
  onClose: () => void;
}

export function AnesthesiaChartModal({ orderId, onClose }: AnesthesiaChartModalProps) {
  return (
    <Modal title="麻酔チャート" onClose={onClose} className="modal--anes-chart anes-chart">
      <AnesthesiaChartPanel orderId={orderId} />
    </Modal>
  );
}
