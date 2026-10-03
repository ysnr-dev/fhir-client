module Master
  # 掲示板の投稿(院内のお知らせ)。マスタではなく現場が育てる運用データだが、ログイン認証・
  # CSRF・エラー整形を /master の基底と共有するためここに置く(チャート定義と同じ理由)。
  #
  # 認可: 読むのはログインした人なら誰でも。投稿も誰でもできる。直す・消すのは投稿した本人か
  # administrator(ヘッダ認証の運用ツールも同じ扱い)。認証なしモード(ADMIN_TOKEN 未設定)は
  # 開発の摩擦を無くすためのものなので誰でも直せる。
  class BulletinPostsController < BaseController
    before_action :set_record, only: %i[show update destroy]
    before_action :authorize_author!, only: %i[update destroy]

    # current=true で今日掲載中のものだけにする(ホームのカード)。掲示板の画面は期間外も引く。
    # 「今日」は date で画面から受け取る(サーバーの時計は UTC なので、朝 9 時前は日付がずれる)。
    def index
      records = BulletinPost.ordered
      records = records.current_on(today) if params[:current].to_s == "true"
      page = paginate(records)
      render json: page.merge(items: page[:items].map { |r| detail(r) })
    end

    def show
      render json: detail(@record)
    end

    # 投稿者はログイン中の本人に固定する(他人の author_id を送られても無視する)。
    # administrator は Practitioner を持たないので author_id は空のまま、表示名だけ残す。
    def create
      record = BulletinPost.new(record_params)
      record.author_id = current_user&.practitioner_fhir_id unless @user_auth == :none
      record.author_name = "管理者" if record.author_name.blank? && administrator_session?
      if record.save
        render json: detail(record), status: :created
      else
        render_validation_errors(record)
      end
    end

    # 投稿者は付け替えさせない。
    def update
      if @record.update(record_params.except(:author_id, :author_name))
        render json: detail(@record)
      else
        render_validation_errors(@record)
      end
    end

    private

    def model_class = BulletinPost

    def today
      @today ||= params[:date].present? ? Date.iso8601(params[:date]) : FacilityClock.today
    rescue Date::Error
      @today = FacilityClock.today
    end

    def record_params
      params.permit(:title, :body, :pinned, :published_from, :published_until, :author_id, :author_name)
    end

    def authorize_author!
      return if editable?(@record)

      render json: { error: "forbidden" }, status: :forbidden
    end

    def editable?(record)
      return true if %i[none header].include?(@user_auth) || administrator_session?

      current_user.present? && record.author_id.present? &&
        record.author_id == current_user.practitioner_fhir_id
    end

    def detail(record)
      record.as_json(only: %i[id title body pinned published_from published_until
                              author_id author_name created_at updated_at])
            .merge("current" => record.current_on?(today), "editable" => editable?(record))
    end
  end
end
