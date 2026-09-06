# オーダーセットに含まれるオーダー 1 件ぶん。values はフロントのオーダー登録フォームの
# 入力値そのもの(患者への参照はフロントが保存前に落とす)。backend は中身を見ない。
class OrderSetEntry < ApplicationRecord
  # フロントの OrderSetOrderType(fhir/orderSetHelpers.ts)と同じ綴り。
  # condition は病名(FHIR Condition)。オーダーではないが、セットのエントリとして同列に扱う。
  ORDER_TYPES = %w[
    condition
    prescription injection lab-order micro-order patho-order rad-order physio-order
    endoscopy-order treatment-order surgery-order meal-order transfusion-order
    rehab-order nutrition-guidance-order consult-order nursing-order
  ].freeze

  # 外部キーを張らない方針に合わせ optional にし、存在は親側の has_many で担保する。
  belongs_to :order_set, optional: true

  validates :order_type, inclusion: { in: ORDER_TYPES }
  validates :schema_version, numericality: { only_integer: true, greater_than: 0 }
  validate :values_must_be_object

  private

  def values_must_be_object
    errors.add(:values, "はオブジェクトで指定してください") unless values.is_a?(Hash)
  end
end
