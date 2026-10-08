module Dpc
  # 手術・処置等の薬剤(点数表の 4 桁コード + 一般名)に当たる薬剤を、投与した薬剤から探す。
  #
  # 点数表の薬剤コードと医薬品コード(YJ)の対応表は配布されていないので、名前で突き合わせる。
  # 機械で決めきれないので結果は「候補」で、人が確定・除外する(Overrides)。
  #
  # 突き合わせ方(どれか 1 つで候補):
  #   generic  医薬品マスタの一般名(「【般】」と規格を外す)・基本名称・名称に点数表の名前が含まれる
  #   salt     塩・水和物の部分を外した名前で含まれる(「イリノテカン塩酸塩」→「イリノテカン」)
  #   yj       名前で当たった医薬品と YJ の先頭 7 桁(成分・剤形)が同じ(先発の商品名を拾う)
  # 点数表の名前の但し書き(「注射薬に限る。」など)のうち剤形で決まるものは剤形で絞り、
  # 決まらないものは注記に残す。
  class DrugMatcher
    Candidate = Struct.new(:code, :name, :matches, :note, keyword_init: true)
    Match = Struct.new(:item, :via, keyword_init: true)

    SALT_SUFFIXES = %w[
      塩酸塩 硫酸塩 酢酸塩 リン酸塩 クエン酸塩 マレイン酸塩 メシル酸塩 トシル酸塩 ベシル酸塩 酒石酸塩 フマル酸塩
      臭化水素酸塩 水和物 ナトリウム カリウム カルシウム マグネシウム
    ].freeze

    # 剤形(医薬品マスタの剤形区分)で決まる但し書き。
    FORM_RULES = [
      [/注射薬に限る/, ->(form) { form == "4" }],
      [/内服薬/, ->(form) { form == "1" }],
      [/外用薬を除く/, ->(form) { form != "6" }]
    ].freeze

    # names: { 4 桁コード => 点数表の名前 }。items: 投与した薬剤(Dpc::Item、medicine 付き)。
    def initialize(names:, items:)
      @names = names
      @items = items.select(&:medicine?)
    end

    def call
      return [] if items.empty?

      names.filter_map do |code, name|
        base, restriction = split_restriction(name)
        matches = matches_for(base)
        matches = filter_by_form(matches, restriction)
        next if matches.empty?

        Candidate.new(code: code, name: name, matches: matches, note: note_for(restriction))
      end
    end

    private

    attr_reader :names, :items

    def split_restriction(name)
      text = normalize(name)
      restriction = text[/（(.+)）\z/, 1]
      [text.sub(/（.+）\z/, ""), restriction]
    end

    def normalize(text)
      text.to_s.unicode_normalize(:nfkc).gsub(/[[:space:]　]/, "").gsub(/\(遺伝子組換え\)|（遺伝子組換え）/, "")
           .tr("()", "（）")
    end

    def matches_for(base)
      return [] if base.blank?

      weak = strip_salt(base)
      direct = items.filter_map do |item|
        haystack = medicine_names(item.medicine)
        if haystack.any? { |text| text.include?(base) }
          Match.new(item: item, via: "generic")
        elsif weak != base && weak.length >= 3 && haystack.any? { |text| text.include?(weak) }
          Match.new(item: item, via: "salt")
        end
      end
      direct + same_ingredient(base, weak, direct)
    end

    # 名前で当たらなかった投与薬のうち、医薬品マスタで同じ名前の薬と YJ 先頭 7 桁が同じもの。
    def same_ingredient(base, weak, direct)
      matched = direct.map { |match| match.item.medicine.code }
      rest = items.reject { |item| matched.include?(item.medicine.code) || item.medicine.yj_code.blank? }
      return [] if rest.empty?

      term = Master::SearchNormalizer.normalize(weak.length >= 3 ? weak : base)
      like = "%#{ActiveRecord::Base.sanitize_sql_like(term)}%"
      yj7 = Master::Medicine.where("search_generic LIKE :q OR search_name LIKE :q", q: like)
                            .where.not(yakka_code: [nil, ""]).limit(500).pluck(:yakka_code)
                            .to_set { |code| code[0, 7] }
      rest.select { |item| yj7.include?(item.medicine.yj_code[0, 7]) }.map { |item| Match.new(item: item, via: "yj") }
    end

    def medicine_names(medicine)
      [medicine.generic_name.to_s.sub("【般】", ""), medicine.basic_name, medicine.name]
        .map { |text| normalize(text) }.reject(&:blank?)
    end

    def strip_salt(base)
      SALT_SUFFIXES.reduce(base) { |text, suffix| text.delete_suffix(suffix) }
    end

    def filter_by_form(matches, restriction)
      return matches if restriction.nil?

      rule = FORM_RULES.find { |pattern, _| restriction.match?(pattern) }
      return matches if rule.nil?

      matches.select { |match| rule.last.call(match.item.medicine.dosage_form.to_s) }
    end

    def note_for(restriction)
      return nil if restriction.nil?
      return nil if FORM_RULES.any? { |pattern, _| restriction == "#{pattern.source}。" }

      restriction
    end
  end
end
