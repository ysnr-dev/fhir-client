class AddTemplatesToMasterRadItems < ActiveRecord::Migration[8.0]
  # 放射線オーダーの「検査目的」「特記事項」を、診療記録(SOAP)と同じテンプレート
  # (Questionnaire)から記入できるようにする。撮影項目ごとに既定のテンプレートを
  # 決めておき、オーダー画面はそれを最初から選んだ状態でテンプレート記入を開く。
  #
  # 値は Questionnaire の canonical("<url>|<version>"、版なしは url のみ)。
  # QuestionnaireResponse.questionnaire と同じ形で、id ではなく canonical で指すのは
  # テンプレートを作り直しても指し先が変わらないようにするため。
  def change
    add_column :master_rad_items, :purpose_template_canonical, :string
    add_column :master_rad_items, :remarks_template_canonical, :string
  end
end
