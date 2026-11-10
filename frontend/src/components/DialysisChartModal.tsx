import { DialysisChartPanel } from "./DialysisChartPanel";
import { Modal } from "./Modal";

// カルテの透析カードの実施履歴から開く透析経過表。中身は専用ページと同じパネルで、
// カルテを見ながらその回の経過を読み返したり、書き忘れた打点を足したりするためのもの。
// グラフが横に伸びるので、モーダルの中でいちばん広い幅を使う。

interface DialysisChartModalProps {
  sessionId: string;
  onClose: () => void;
}

export function DialysisChartModal({ sessionId, onClose }: DialysisChartModalProps) {
  return (
    <Modal title="透析経過表" onClose={onClose} className="modal--time-chart time-chart">
      <DialysisChartPanel sessionId={sessionId} />
    </Modal>
  );
}
