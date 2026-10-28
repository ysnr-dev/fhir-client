class AddTokenSaltToWaitingBoardLinks < ActiveRecord::Migration[8.0]
  # 施設設定から表示板をいつでも開けるよう、トークンを salt + secret_key_base から起こし直せるようにする
  # (WaitingBoardLink.token_for)。DB には salt と digest だけを持ち、生のトークンは持たない。
  # salt の無いリンクは起こし直せない(発行し直す)。
  def change
    add_column :waiting_board_links, :token_salt, :string
  end
end
