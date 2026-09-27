class AddReportFindingsTemplateToMasterPhysioEndoscopyItems < ActiveRecord::Migration[8.0]
  # 所見レポートの「所見」を記入するテンプレート(Questionnaire)の既定。検査項目ごとに
  # 決めておき、所見レポートの入力画面はそれを最初から選んだ状態でテンプレート記入を開く
  # (docs/exam-report-design.md)。値は検査目的・特別指示と同じく canonical。
  def change
    add_column :master_physio_items, :report_findings_template_canonical, :string
    add_column :master_endoscopy_items, :report_findings_template_canonical, :string
  end
end
