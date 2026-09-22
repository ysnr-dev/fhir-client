module Integrations
  module ReceiptComputer
    # 施設設定 receipt_codes の読み出し口。施設基準や届出で決まる「1 施設 1 値」の
    # レセプト電算コード(FacilitySettings::DEFAULT_RECEIPT_CODES)。空は nil にして返し、
    # 呼び側は「設定されていない」として送れない項目に積む。
    class ReceiptCodes
      def initialize(settings = FacilitySettings.receipt_codes)
        @settings = settings.is_a?(Hash) ? settings : {}
      end

      # 病理の検査区分(JAHIS LPATHO001: N000 組織診 / N004 細胞診 / N003 術中迅速)。
      def pathology(category) = fetch("pathology", category)

      # 疾患別リハビリテーション料。区分(疾患別)× 療法の担い手(pt / ot / st)。
      def rehab(category, therapy) = fetch("rehab", category, therapy)

      # 栄養食事指導料。initial / follow-up / group。
      def nutrition_guidance(session) = fetch("nutrition_guidance", session)

      # 血液採取(B-V)。検体検査に血液の検体があるとき 1 日 1 回。
      def blood_draw = fetch("lab", "blood_draw")

      # 外来化学療法加算(15 歳未満は別コード)と無菌製剤処理料。レジメン由来の注射に 1 日 1 回。
      def outpatient_chemo_addition(child: false)
        fetch("injection", child ? "outpatient_chemo_addition_child" : "outpatient_chemo_addition")
      end

      def aseptic_preparation = fetch("injection", "aseptic_preparation")

      private

      def fetch(*keys)
        keys.map(&:to_s).reduce(@settings) { |node, key| node.is_a?(Hash) ? node[key] : nil }.presence
      end
    end
  end
end
