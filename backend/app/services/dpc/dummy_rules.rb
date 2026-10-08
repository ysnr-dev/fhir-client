module Dpc
  # 手術・処置等のダミーコード(4 桁)を、実施した点数表コード・薬剤から導く。
  #
  # 導けるもの:
  #   0006 全身麻酔       L008 の実施
  #   0007 リハビリテーション H 章の実施、またはリハビリの実施記録
  #   0008 放射線療法     M 章の実施、または放射線治療の実施記録
  #   0014 精神科専門療法 I 章の実施
  #   0005 化学療法       YJ の先頭が 42(腫瘍用薬)の投与 → 候補(人が確定する)
  #   0046〜0048          化学療法・放射線療法の有無の組
  #   「A＋Bあり」「AありかつBあり」 構成する薬剤・療法がすべて実施済み
  # それ以外(酵素補充療法・大量療法・加算など)は人が上書きで足す。
  module DummyRules
    ANESTHESIA = "0006".freeze
    REHAB = "0007".freeze
    RADIOTHERAPY = "0008".freeze
    PSYCHIATRY = "0014".freeze
    CHEMOTHERAPY = "0005".freeze
    CHEMO_ONLY = "0046".freeze
    CHEMO_AND_RADIO = "0047".freeze
    RADIO_ONLY = "0048".freeze
    DERIVED = [ANESTHESIA, REHAB, RADIOTHERAPY, PSYCHIATRY, CHEMOTHERAPY, CHEMO_ONLY, CHEMO_AND_RADIO,
               RADIO_ONLY].freeze

    # 腫瘍用薬の薬効分類(YJ の先頭 2 桁)。
    ANTINEOPLASTIC_YJ = "42".freeze

    module_function

    # 4 桁コードが単一の薬剤を表すか(DrugMatcher で名前を突き合わせる対象)。
    def single_drug?(code, name)
      return false unless code.match?(/\A\d{4}\z/)
      return false if DERIVED.include?(code) || composite?(name)

      !name.to_s.match?(/療法|検査|内視鏡|加算/)
    end

    def composite?(name)
      name.to_s.match?(/＋|\+|ありかつ/)
    end

    # 「A＋B＋Cあり」「AありかつBあり」の構成要素の名前。
    def components(name)
      name.to_s.unicode_normalize(:nfkc).sub(/あり\z/, "").split(/\+|ありかつ/).map(&:strip).reject(&:empty?)
    end

    # 点数表コードから導けるもの。{ コード => 根拠の点数表コード(なければ記録の種類) }
    def from_codes(codes, radiotherapy:, rehab:)
      found = {}
      found[ANESTHESIA] = codes.find { |code| code.start_with?("L008") } if codes.any? { |c| c.start_with?("L008") }
      rehab_code = codes.find { |code| code.match?(/\AH0/) }
      found[REHAB] = rehab_code || "リハビリの実施記録" if rehab_code || rehab
      radio_code = codes.find { |code| code.match?(/\AM0/) }
      found[RADIOTHERAPY] = radio_code || "放射線治療の実施記録" if radio_code || radiotherapy
      psychiatry = codes.find { |code| code.match?(/\AI0/) }
      found[PSYCHIATRY] = psychiatry if psychiatry
      found
    end

    def antineoplastic?(item)
      item.medicine&.yj_code.to_s.start_with?(ANTINEOPLASTIC_YJ)
    end

    # 化学療法・放射線療法の有無の組(0046〜0048)。
    def chemo_radio(chemo:, radio:)
      if chemo && radio then CHEMO_AND_RADIO
      elsif chemo then CHEMO_ONLY
      elsif radio then RADIO_ONLY
      end
    end
  end
end
