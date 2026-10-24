# Be sure to restart your server when you modify this file.

# Configure parameters to be filtered from the log file. Use this to limit dissemination of
# sensitive information. See the ActiveSupport::ParameterFilter documentation for supported
# notations and behaviors.
Rails.application.config.filter_parameters += [
  :passw, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn,
  # DICOM 取込(/imaging/instances)。meta は取込元の患者名・ID を含む。
  :meta, :file,
  # 文書テンプレートの様式のページ画像(/admin/document_templates)。base64 を書き出さない。
  :pages,
  # Web 問診の生年月日の照合(/intake/public/verify)。
  :birth_date
]
