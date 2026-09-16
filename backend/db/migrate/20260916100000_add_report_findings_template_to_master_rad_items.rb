class AddReportFindingsTemplateToMasterRadItems < ActiveRecord::Migration[8.0]
  # 読影レポートの「所見」を記入するテンプレート(Questionnaire)の既定。撮影項目ごとに
  # 決めておき、読影レポートの入力画面はそれを最初から選んだ状態でテンプレート記入を開く
  # (docs/rad-report-design.md §7)。値は検査目的・特別指示と同じく canonical。
  def change
    add_column :master_rad_items, :report_findings_template_canonical, :string
  end
end
