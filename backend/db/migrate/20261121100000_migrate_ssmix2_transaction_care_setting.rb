# 入外区分は HL7 v3 ActCode(IMP / AMB)で持つ(CareSetting)。SS-MIX2 の送信待ちに写してある
# 書き込みの内容(request / response)には独自 CodeSystem(prescription-setting / lab-result-setting)の
# 区分が残っているので、同じ対応で書き換える(そのままだと入院のオーダーが外来として出力される)。
# 上流 FHIR サーバーの MigrateCareSettingToActCode と同じ対応。
class MigrateSsmix2TransactionCareSetting < ActiveRecord::Migration[8.0]
  class MigrationTransaction < ActiveRecord::Base
    self.table_name = "ssmix2_transactions"
  end

  OLD_SYSTEMS = [
    "http://fhir-client.local/CodeSystem/prescription-setting",
    "http://fhir-client.local/CodeSystem/lab-result-setting"
  ].freeze
  ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode".freeze
  ACT_CODES = {
    "inpatient" => { "code" => "IMP", "display" => "inpatient encounter" },
    "outpatient" => { "code" => "AMB", "display" => "ambulatory" }
  }.freeze

  def up
    conditions = OLD_SYSTEMS.flat_map { [ "request::text LIKE ?", "response::text LIKE ?" ] }.join(" OR ")
    patterns = OLD_SYSTEMS.flat_map { |system| [ "%#{system}%" ] * 2 }
    MigrationTransaction.where(conditions, *patterns).find_in_batches(batch_size: 100) do |batch|
      batch.each do |row|
        row.update_columns(request: converted(row.request), response: converted(row.response))
      end
    end
  end

  def down
    # 書き換えた区分と新しく記録された区分を区別できないので戻さない。
  end

  private

  # 対応の無いコード(未選択のまま書かれた空の区分)は Coding ごと落とし、空になった category も落とす。
  def converted(node)
    case node
    when Array then node.map { |child| converted(child) }
    when Hash
      result = node.transform_values { |child| converted(child) }
      result["category"] = converted_categories(result["category"]) if result["category"].is_a?(Array)
      result
    else node
    end
  end

  def converted_categories(categories)
    categories.filter_map do |category|
      next category unless category.is_a?(Hash) && category["coding"].is_a?(Array)

      codings = category["coding"].filter_map { |coding| converted_coding(coding) }
      category.merge("coding" => codings) if codings.any?
    end
  end

  def converted_coding(coding)
    return coding unless coding.is_a?(Hash) && OLD_SYSTEMS.include?(coding["system"])

    act_code = ACT_CODES[coding["code"]]
    coding.merge("system" => ACT_CODE_SYSTEM, **act_code) if act_code
  end
end
