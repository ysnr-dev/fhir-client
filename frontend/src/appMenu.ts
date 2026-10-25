// ヘッダーのメニュー(「管理」以外)の登録表。App.tsx はこの表を描き、ホームのショートカットの
// 候補(components/homeCards/ShortcutsCard)もここから引く(「管理」からはマスタメンテだけを足す)。項目を足すときはここに 1 行足す。
//
// 並びの考え方:
//   患者一覧 … 患者を探す入口。患者検索で探すか、その日の外来予約から探すかで分ける。
//   診療業務 … 「診療科の医師が捌く仕事」。部門業務(依頼を受ける部門の仕事)とは受け手が違う
//              — 他科依頼を受けるのは技師ではなく他科の医師で、返すのは結果ではなく診療記録
//              (docs/consult-order-design.md §1)。
//   看護業務 … 病棟の看護師の画面。どれも病棟を指定しなければ先頭の病棟で開く。
//   部門業務 … 「依頼を受けた側」の画面。項目が多いので部門ごとに入れ子にする
//              (1 項目だけの部門も並びを揃えるためサブメニューにする)。
//   予約枠   … 診療科がオーダーを出す前段(いつ診るかを決める)なので独立して置く。
//   掲示板   … 院内のお知らせ。職種を問わず全員が読むので独立して置く(ホームにも出る)。
//   データ   … 院外へ提出するデータ(DPC 調査など)と、患者を条件で抜き出す二次利用のデータ。

export interface AppMenuItem {
  label: string;
  to: string;
}

export type AppMenuEntry =
  | { kind: "menu"; label: string; items: AppMenuItem[] }
  | { kind: "menu"; label: string; sections: { label: string; items: AppMenuItem[] }[] }
  | { kind: "link"; label: string; to: string };

export const APP_MENU: AppMenuEntry[] = [
  {
    kind: "menu",
    label: "患者一覧",
    items: [
      { label: "患者検索", to: "/patients" },
      // その日の予約患者を受付する画面。
      { label: "外来患者一覧", to: "/outpatients" },
      // 救急外来に来院した患者を来院から転帰まで追う画面。
      { label: "救急患者一覧", to: "/emergency" },
      // 病棟のベッドの埋まり具合と在院患者を見る画面。
      { label: "入院患者一覧", to: "/inpatients" },
      // 入院患者一覧の別の見え方(間取りの上に患者を出す)。
      { label: "病棟マップ", to: "/ward-map" },
      // ベッド × 日付の帯で入院・予定を見る画面と、病棟ごとの集計。
      { label: "ベッドスケジュール", to: "/bed-schedule" },
      { label: "病床状況", to: "/bed-status" },
      // 患者を任意の階層の分類に仕分けて見る画面。
      { label: "患者フォルダ", to: "/patient-folders" },
    ],
  },
  {
    kind: "menu",
    label: "診療業務",
    items: [
      { label: "他科依頼一覧", to: "/consult-worklist" },
      // チーム医療(NST・ICT・褥瘡対策など)への介入依頼。受けるのはチームの医師・看護師・薬剤師など。
      { label: "チーム依頼一覧", to: "/team-worklist" },
      // 宛先の決まった通知(緊急異常値・オーダー承認…)。受け取るのは部門ではなく医師なので
      // 診療業務に置く(docs/features/notifications.md)。件数はヘッダーのベルに出る。
      { label: "通知", to: "/notifications" },
      // 検査レポートのフォロー推奨と、確認されないまま日数が経った検査結果(docs/result-followup-design.md)。
      { label: "検査結果フォロー", to: "/result-followup" },
      // 研修医・学生の記録とオーダーのカウンターサイン(指導医向け。docs/countersign-design.md)。
      { label: "カルテ承認", to: "/countersigns" },
      // 入院診療計画書・退院時サマリー・看護サマリーの作成状況と期限(docs/bed-management-design.md §4)。
      { label: "入退院文書", to: "/admission-documents" },
      // よく出すオーダーのひとまとめ(オーダーセット)。出すのは診療科の医師なので部門業務ではなく
      // ここに置く(docs/order-set-design.md §1)。
      { label: "セット登録", to: "/order-sets" },
    ],
  },
  {
    kind: "menu",
    label: "看護業務",
    items: [
      { label: "指示簿", to: "/nursing-worklist" },
      { label: "ワークシート", to: "/nursing-worksheet" },
      { label: "業務分担", to: "/nursing-assignments" },
      { label: "看護必要度", to: "/nursing-acuity" },
      { label: "褥瘡管理", to: "/pressure-ulcer" },
      { label: "病棟マップ", to: "/ward-map" },
      { label: "血糖インスリン", to: "/insulin-worklist" },
      { label: "看護サマリー承認", to: "/nursing-summary-approvals" },
      { label: "経過表一括入力", to: "/inpatients/bulk-vitals" },
    ],
  },
  {
    kind: "menu",
    label: "部門業務",
    sections: [
      {
        label: "臨床検査部門",
        items: [
          { label: "検体検査一覧", to: "/lab-worklist" },
          { label: "検体到着確認", to: "/lab-arrivals" },
          // 検査室・分析装置・外注ラボから受け取った結果ファイルを読み込む(docs/lab-result-import-design.md)。
          { label: "検査結果取込", to: "/lab-result-imports" },
        ],
      },
      { label: "病理部門", items: [{ label: "病理検査一覧", to: "/patho-worklist" }] },
      {
        label: "放射線部門",
        items: [
          { label: "放射線検査一覧", to: "/rad-worklist" },
          // 放射線治療は装置 × 時刻のカレンダーで照射の予定と実績を見る(右に治療コースの一覧)。
          { label: "放射線治療カレンダー", to: "/radiotherapy-worklist" },
        ],
      },
      { label: "生理検査部門", items: [{ label: "生理検査一覧", to: "/physio-worklist" }] },
      { label: "内視鏡部門", items: [{ label: "内視鏡一覧", to: "/endoscopy-worklist" }] },
      {
        label: "手術部門",
        items: [
          { label: "手術一覧", to: "/surgery-worklist" },
          // 手術一覧が「その日の手術を 1 件ずつ処理する」画面なのに対し、カレンダーは
          // 「空いているところを探して日程を組む」画面。
          { label: "手術カレンダー", to: "/surgery-calendar" },
        ],
      },
      // 輸血は依頼を受けてから製剤を払い出すまでが部門の仕事で、投与は病棟。
      { label: "輸血部門", items: [{ label: "輸血一覧", to: "/transfusion-worklist" }] },
      // リハビリは他の部門一覧と違い「その日に効いている期間オーダー」を並べる
      // (1 オーダーが数か月続き、実施が日々積み上がる)。
      { label: "リハビリ部門", items: [{ label: "リハビリ一覧", to: "/rehab-worklist" }] },
      {
        label: "栄養部門",
        items: [
          // 栄養指導もリハビリと同じ期間継続型(1 オーダーに初回・継続の指導が積み上がる)。
          { label: "栄養指導一覧", to: "/nutrition-guidance-worklist" },
          // 給食はオーダーを 1 件ずつ処理せず、その日の食事を患者別に並べて食数を数える。
          { label: "食事一覧", to: "/meal-worklist" },
        ],
      },
      {
        label: "薬剤部門",
        items: [
          { label: "処方監査", to: "/rx-verification" },
          { label: "処方一覧", to: "/rx-worklist" },
          { label: "持参薬鑑別一覧", to: "/brought-med-worklist" },
          // 服薬指導は栄養指導と同じ期間継続型(1 オーダーに入院中の指導が積み上がる)。
          { label: "服薬指導一覧", to: "/medication-guidance-worklist" },
          { label: "注射一覧", to: "/injection-worklist" },
          { label: "ロット管理", to: "/lot-management" },
          { label: "抗菌薬適正使用", to: "/ast-worklist" },
        ],
      },
      { label: "処置", items: [{ label: "処置一覧", to: "/treatment-worklist" }] },
      // 化学療法室は注射一覧(オーダー軸)と違い、その日の予約(時間割)で回る部門なので
      // 別の面にする(docs/chemo-regimen-design.md §7.6 E-7)。
      { label: "外来化学療法室", items: [{ label: "外来化学療法室", to: "/chemo-room-worklist" }] },
    ],
  },
  { kind: "link", label: "予約枠", to: "/schedules" },
  { kind: "link", label: "掲示板", to: "/bulletin" },
  {
    kind: "menu",
    label: "データ",
    items: [
      { label: "DPC患者", to: "/dpc-patients" },
      { label: "DPC様式1", to: "/dpc-form1-export" },
      // 院内がん登録の登録対象(がんの病名)と登録・届出の状況(docs/cancer-registry-design.md)。
      { label: "院内がん登録", to: "/cancer-registry" },
      { label: "データ抽出", to: "/data-extract" },
      { label: "分析ダッシュボード", to: "/dashboards" },
    ],
  },
];

// 「管理」メニューの項目のうち、ショートカットに置けるもの。管理の他の項目は設定画面なので候補に入れない。
const ADMIN_SHORTCUT_LINKS: AppMenuItem[] = [{ label: "マスタメンテ", to: "/masters" }];

/**
 * ショートカットの候補(メニューの順に平坦化し、末尾に ADMIN_SHORTCUT_LINKS。
 * 病棟マップのように 2 か所にある画面は 1 つに)。
 */
export function appMenuLinks(): AppMenuItem[] {
  const seen = new Set<string>();
  const links: AppMenuItem[] = [];
  const push = (item: AppMenuItem) => {
    if (seen.has(item.to)) return;
    seen.add(item.to);
    links.push(item);
  };
  for (const entry of APP_MENU) {
    if (entry.kind === "link") push({ label: entry.label, to: entry.to });
    else if ("sections" in entry) entry.sections.forEach((s) => s.items.forEach(push));
    else entry.items.forEach(push);
  }
  ADMIN_SHORTCUT_LINKS.forEach(push);
  return links;
}

export function appMenuLabelOf(to: string): string | undefined {
  return appMenuLinks().find((item) => item.to === to)?.label;
}
