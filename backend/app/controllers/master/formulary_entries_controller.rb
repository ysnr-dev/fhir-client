module Master
  # 薬効群に載せる医薬品。追加は群の末尾(最大 rank + 1)、並べ替えは reorder でまとめて。
  class FormularyEntriesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def create
      record = Master::FormularyEntry.new(record_params)
      if record.rank.blank?
        record.rank = (Master::FormularyEntry.where(formulary_group_id: record.formulary_group_id).maximum(:rank) || 0) + 1
      end
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # ids の並び順で rank を 1 から振り直す。同じ群の薬剤だけを受け付ける。
    def reorder
      ids = Array(params[:ids]).map(&:to_i)
      entries = Master::FormularyEntry.where(id: ids).index_by(&:id)
      if entries.size != ids.size || entries.values.map(&:formulary_group_id).uniq.size > 1
        return render json: { error: "同じ群の薬剤を過不足なく指定してください" }, status: :unprocessable_content
      end

      Master::FormularyEntry.transaction do
        ids.each_with_index { |id, i| entries[id].update!(rank: i + 1) }
      end
      head :no_content
    end
  end
end
