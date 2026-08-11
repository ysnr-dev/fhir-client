module Master
  # シェーマ台紙のカテゴリ。parent_id の隣接リストで任意の深さの階層を表す。
  # ツリーの組み立てはフロント側で行い、backend は循環の防止だけ担保する。
  class SchemaCategory < ApplicationRecord
    self.table_name = "master_schema_categories"

    # 循環検出の遡上上限。実運用の階層は数段で足りるため、これを超えたら
    # データ異常とみなして循環扱いにする(無限ループの保険)。
    MAX_DEPTH = 50

    validates :name, presence: true
    validate :parent_must_not_cycle, if: -> { parent_id.present? }

    private

    # 自分自身や子孫を親に指定すると木が循環して辿れなくなるため拒否する。
    def parent_must_not_cycle
      current = parent_id
      MAX_DEPTH.times do
        return if current.nil?
        if current == id
          errors.add(:parent_id, "に自分自身または子孫のカテゴリは指定できません")
          return
        end
        current = self.class.where(id: current).pick(:parent_id)
      end
      errors.add(:parent_id, "の階層が深すぎます")
    end
  end
end
