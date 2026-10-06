module Master
  # 薬剤付加情報(docs/lot-number-design.md)。施設独自の薬剤の設定を 1 薬 1 行で持つ。
  # 一覧は医薬品名を JOIN して返し、項目の実効値(既定を含む)も添える。
  class MedicineAttributesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    MEDICINE_JOIN = "LEFT JOIN master_medicines ON master_medicines.medicine_code = " \
                    "master_medicine_attributes.medicine_code".freeze

    # 登録済みの行。default=true で、行が無くても既定で対象になる薬(生物学的製剤の印のある薬)も並べる。
    def index
      records = Master::MedicineAttribute.joins(MEDICINE_JOIN)
                                         .select("master_medicine_attributes.*",
                                                 "master_medicines.name AS medicine_name",
                                                 "master_medicines.unit_name AS medicine_unit_name")
                                         .order("master_medicines.name NULLS LAST", :medicine_code)
                                         .to_a
      medicines = Master::Medicine.where(medicine_code: records.map(&:medicine_code)).index_by(&:medicine_code)
      rows = records.map { |record| row(record, medicines[record.medicine_code]) }
      rows += default_rows(records.map(&:medicine_code)) if params[:default].to_s == "true"
      render json: { definitions: Master::MedicineAttribute.definitions, items: rows }
    end

    def definitions
      render json: Master::MedicineAttribute.definitions
    end

    # コード → 項目の実効値。実施入力が行ごとに「ロット欄を出すか」を決めるのに使う。
    def lookup
      codes = params[:medicine_code].to_s.split(",").map(&:strip).reject(&:blank?).uniq
      records = Master::MedicineAttribute.where(medicine_code: codes).index_by(&:medicine_code)
      medicines = Master::Medicine.where(medicine_code: codes).index_by(&:medicine_code)
      render json: codes.to_h { |code| [code, Master::MedicineAttribute.effective(records[code], medicines[code])] }
    end

    def show
      render json: row(@record, Master::Medicine.find_by(medicine_code: @record.medicine_code))
    end

    def create
      record = Master::MedicineAttribute.new(record_params)
      if record.save
        render json: row(record, Master::Medicine.find_by(medicine_code: record.medicine_code)), status: :created
      else
        render_validation_errors(record)
      end
    end

    def update
      if @record.update(record_params.except(:medicine_code))
        render json: row(@record, Master::Medicine.find_by(medicine_code: @record.medicine_code))
      else
        render_validation_errors(@record)
      end
    end

    private

    def model_class = Master::MedicineAttribute

    def record_params
      permitted = params.permit(:medicine_code, :note)
      # settings は項目の表にあるキーだけを受け取る(未知のキーは JsonShape が弾けるよう、そのまま渡す)。
      permitted[:settings] = params[:settings].to_unsafe_h if params[:settings].respond_to?(:to_unsafe_h)
      permitted
    end

    def row(record, medicine)
      {
        id: record.id,
        medicine_code: record.medicine_code,
        medicine_name: medicine&.name,
        medicine_unit_name: medicine&.unit_name,
        settings: record.settings,
        effective: Master::MedicineAttribute.effective(record, medicine),
        note: record.note,
        registered: true
      }
    end

    # 行は無いが、既定で項目が真になる薬(いまは生物学的製剤の印がある薬のロット管理)。
    def default_rows(registered_codes)
      Master::Medicine.where(biological_product_flag: "1").where.not(medicine_code: registered_codes)
                      .order(:name).map do |medicine|
        {
          id: nil,
          medicine_code: medicine.medicine_code,
          medicine_name: medicine.name,
          medicine_unit_name: medicine.unit_name,
          settings: {},
          effective: Master::MedicineAttribute.effective(nil, medicine),
          note: nil,
          registered: false
        }
      end
    end
  end
end
