class AddPreopTemplateToMasterSurgeryItems < ActiveRecord::Migration[8.0]
  # 手術オーダーの「術前指示」を、放射線・生理検査・内視鏡の特別指示と同じく
  # テンプレート(Questionnaire)から記入できるようにする。術式ごとに既定の
  # テンプレートを決めておき、申込画面はそれを最初から選んだ状態で記入を開く。
  #
  # 値は Questionnaire の canonical("<url>|<version>"、版なしは url のみ)。
  # id ではなく canonical で指すのは、テンプレートを作り直しても指し先が
  # 変わらないようにするため(master_rad_items と同じ)。
  #
  # 術前指示は「検査目的/特別指示」の 2 本立てではなく 1 本。手術部への申し送りは
  # 既にオーダーの特記欄(note)にあり、術前指示は宛先が病棟で別物なので分けている。
  def change
    add_column :master_surgery_items, :preop_template_canonical, :string
  end
end
